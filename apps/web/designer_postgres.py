"""PostgreSQL Data Designer for the local Workflow Creator server."""

import hashlib
import json
import os
import re
import sys
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal
from urllib.parse import unquote
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import ConfigDict, Field, ValidationError, create_model

WORKSPACE = "local"
TYPES = {
    "text": str, "integer": int, "decimal": Decimal,
    "boolean": bool, "date": date, "timestamp": datetime,
}
FIELD_KEYS = {"name", "ftype", "required", "unique", "repeated", "default", "validation"}


class RequestError(Exception):
    def __init__(self, message, status=400, **details):
        self.status = status
        self.data = {"error": message, **details}


def digest(value):
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def active_fields(fields):
    return [field for field in fields if field["status"] == "active"]


def model_for(fields):
    definitions = {}
    for field in active_fields(fields):
        name = field["name"]
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) or name in definitions:
            raise RequestError(f"Invalid or duplicate field name: {name}")
        kind = field["ftype"]
        rules = field["validation"]
        options = {}
        if kind == "enum":
            choices = rules.get("options", [])
            if not choices or not all(isinstance(choice, str) for choice in choices):
                raise RequestError(f"{name} requires text options")
            value_type = Literal[tuple(choices)]
        elif kind in TYPES:
            value_type = TYPES[kind]
        else:
            raise RequestError(f"Unknown field type: {kind}")
        if kind == "text":
            names = {"minLength": "min_length", "maxLength": "max_length", "pattern": "pattern"}
            options = {target: rules[key] for key, target in names.items() if key in rules}
        if kind in ("integer", "decimal"):
            convert = Decimal if kind == "decimal" else int
            options.update({target: convert(str(rules[key])) for key, target in
                            {"min": "ge", "max": "le"}.items() if key in rules})
        if kind == "decimal":
            options.update({target: rules[key] for key, target in
                            {"precision": "max_digits", "scale": "decimal_places"}.items() if key in rules})
        if options:
            value_type = Annotated[value_type, Field(**options)]
        if field["repeated"]:
            value_type = list[value_type]
        if not field["required"]:
            value_type = value_type | None
        default = field["default"]
        if default is None and field["required"]:
            default = ...
        definitions[name] = (value_type, default)
    config = ConfigDict(extra="forbid", validate_default=True)
    model = create_model("DesignerRecord", __config__=config, **definitions)
    defaults = {name: definition for name, definition in definitions.items() if definition[1] is not ...}
    create_model("DesignerDefaults", __config__=config, **defaults).model_validate({})
    return model


def validate_values(fields, values):
    return model_for(fields).model_validate(values).model_dump(mode="json", exclude_none=True)


def initialize(conn):
    # Serializes first-time setup and schema/record mutations within this database.
    conn.execute("SELECT pg_advisory_xact_lock(741320159)")
    conn.execute("CREATE SCHEMA IF NOT EXISTS steel_designer")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS steel_designer.types (
            id text PRIMARY KEY, name text UNIQUE NOT NULL, data jsonb NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS steel_designer.records (
            id text PRIMARY KEY,
            type_id text NOT NULL REFERENCES steel_designer.types(id),
            lifecycle text NOT NULL DEFAULT 'active',
            values_data jsonb NOT NULL
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS steel_designer_records_type
        ON steel_designer.records (type_id, lifecycle, id)
    """)


def save_type(conn, entry):
    conn.execute("""
        INSERT INTO steel_designer.types (id, name, data) VALUES (%s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data
    """, (entry["type_id"], entry["name"], Jsonb(entry)))


def get_type(conn, key):
    row = conn.execute("SELECT data FROM steel_designer.types WHERE id = %s OR name = %s ORDER BY id = %s DESC LIMIT 1",
                       (key, key, key)).fetchone()
    if row is None:
        raise RequestError("Type not found.", 404)
    return row["data"]


def detail(entry):
    fields = entry["fields"]
    sha = digest(fields)
    validated = entry.get("validated")
    return {key: value for key, value in entry.items() if key != "versions"} | {
        "draft_sha256": sha,
        "validated": validated | {"current": validated["draft_sha256"] == sha} if validated else None,
    }


def published(entry):
    if not entry["versions"]:
        raise RequestError("Publish this type before using its records.", 409)
    return entry["versions"][-1]


def record_view(row, entry, spec):
    return {
        "record_id": row["id"], "workspace_id": WORKSPACE, "type_id": row["type_id"],
        "type_name": entry["name"], "type_version": spec["version"],
        "lifecycle": row["lifecycle"], "values": row["values_data"],
        "field_ids": {field["name"]: field["field_id"] for field in active_fields(spec["fields"])},
        "links": [],
    }


def check_unique(conn, entry, fields, values, record_id):
    unique = {field["name"] for field in active_fields(fields) if field["unique"]}
    for name in unique.intersection(values):
        match = conn.execute("""
            SELECT 1 FROM steel_designer.records
            WHERE type_id = %s AND id <> %s AND lifecycle = 'active'
            AND values_data @> %s LIMIT 1
        """, (entry["type_id"], record_id, Jsonb({name: values[name]}))).fetchone()
        if match:
            raise RequestError(f"Field {name} must be unique.", 409)


def records(conn, entry, method, tail, query, body):
    spec = published(entry)
    fields = spec["fields"]
    if method == "POST" and not tail:
        key = uuid4().hex
        values = validate_values(fields, body.get("values", {}))
        check_unique(conn, entry, fields, values, key)
        row = conn.execute("""
            INSERT INTO steel_designer.records (id, type_id, values_data)
            VALUES (%s, %s, %s) RETURNING *
        """, (key, entry["type_id"], Jsonb(values))).fetchone()
        return {"ok": True, "record": record_view(row, entry, spec)}
    if (method, tail) not in [("GET", []), ("POST", ["query"])]:
        raise RequestError("Record operation is unavailable.", 404)
    options = body if tail else query
    lifecycle = options.get("lifecycle", "active")
    limit = min(max(int(options.get("limit", 100)), 1), 1000)
    filters = options.get("filters") or {}
    if not isinstance(filters, dict) or filters.keys() - {f["name"] for f in active_fields(fields)}:
        raise RequestError("Filters must name published fields.")
    filter_fields = [field for field in fields if field["name"] in filters]
    if any(value is None for value in filters.values()):
        raise RequestError("Filter values must be non-null.")
    normalized = validate_values(filter_fields, filters)
    rows = conn.execute("""
        SELECT * FROM steel_designer.records
        WHERE type_id = %s AND (%s = 'all' OR lifecycle = %s) AND values_data @> %s
        ORDER BY id LIMIT %s
    """, (entry["type_id"], lifecycle, lifecycle, Jsonb(normalized), limit)).fetchall()
    return {"records": [record_view(row, entry, spec) for row in rows]}


def publish(conn, entry):
    new_fields = entry["fields"]
    model_for(new_fields)
    if entry["version"] and entry["versions"][-1]["fields"] != new_fields:
        exists = conn.execute("SELECT 1 FROM steel_designer.records WHERE type_id = %s LIMIT 1",
                              (entry["type_id"],)).fetchone()
        if exists:
            raise RequestError("Changing a published schema with existing records requires a migration.", 409)
    version = entry["version"] + 1
    sha = digest(new_fields)
    spec = {
        "type_id": entry["type_id"], "workspace_id": WORKSPACE, "name": entry["name"],
        "version": version, "status": "published", "spec_sha256": sha,
        "fields": new_fields, "relationships": [],
    }
    entry["versions"].append(spec)
    entry["version"] = version
    entry["validated"] = {"ok": True, "draft_sha256": sha}
    save_type(conn, entry)
    return {"ok": True, "version": version, "ops": [], "destructive": [], "records_checked": 0,
            "backfilled": 0, "backup_path": None, "backup_note": None, "spec_sha256": sha}


def field_change(conn, entry, field, body):
    field.update({key: value for key, value in body.items() if key in FIELD_KEYS})
    if field["unique"] and field["repeated"]:
        raise RequestError("Repeated fields cannot be unique.")
    model_for(entry["fields"])
    save_type(conn, entry)
    return {"ok": True, "field": field}


def handle(conn, method, parts, query, body):
    if parts in (["workspace"], ["types"]) and method == "GET":
        rows = conn.execute("SELECT data FROM steel_designer.types ORDER BY name").fetchall()
        return {"workspace": WORKSPACE, "types": [detail(row["data"]) for row in rows
                if row["data"]["status"] == "active" or query.get("include_archived") == "1"]}
    if parts == ["types"] and method == "POST":
        name = body.get("name", "").strip()
        if not name:
            raise RequestError("Type name is required.")
        entry = {"type_id": uuid4().hex, "workspace_id": WORKSPACE, "name": name, "status": "active",
                 "version": 0, "fields": [], "relationships": [], "versions": []}
        save_type(conn, entry)
        return {"ok": True, "type": detail(entry)}
    if parts[:1] == ["types"] and len(parts) >= 2:
        entry = get_type(conn, parts[1])
        tail = parts[2:]
        if method == "GET" and not tail:
            return {"type": detail(entry)}
        if method == "PATCH" and not tail:
            name = body.get("name", "").strip()
            if not name:
                raise RequestError("Type name is required.")
            entry["name"] = name
            save_type(conn, entry)
            return {"ok": True, "type": detail(entry)}
        if method == "POST" and tail in (["archive"], ["unarchive"]):
            entry["status"] = "archived" if tail == ["archive"] else "active"
            save_type(conn, entry)
            return {"ok": True, "type": detail(entry)}
        if method == "POST" and tail == ["fields"]:
            field = {"field_id": uuid4().hex, "name": "", "ftype": "text", "required": False,
                     "unique": False, "repeated": False, "default": None, "validation": {},
                     "position": len(entry["fields"]), "status": "active"}
            entry["fields"].append(field)
            return field_change(conn, entry, field, body)
        if method == "POST" and tail == ["validate"]:
            model_for(entry["fields"])
            sha = digest(entry["fields"])
            entry["validated"] = {"ok": True, "draft_sha256": sha}
            save_type(conn, entry)
            return {"ok": True, "errors": [], "draft_sha256": sha}
        if method == "POST" and tail == ["publish"]:
            return publish(conn, entry)
        if method == "GET" and tail[:1] == ["versions"]:
            versions = entry["versions"]
            if len(tail) == 1:
                return {"versions": [{"version": spec["version"], "spec_sha256": spec["spec_sha256"],
                        "created_by": WORKSPACE, "status": "published" if spec is versions[-1] else "superseded"}
                        for spec in reversed(versions)]}
            for spec in versions:
                if str(spec["version"]) == tail[1]:
                    return {"spec": spec}
            raise RequestError("Schema version not found.", 404)
        if tail[:1] == ["records"]:
            return records(conn, entry, method, tail[1:], query, body)
    if parts[:1] == ["fields"] and len(parts) >= 2:
        row = conn.execute("SELECT data FROM steel_designer.types WHERE data->'fields' @> %s",
                           (Jsonb([{"field_id": parts[1]}]),)).fetchone()
        if row is None:
            raise RequestError("Field not found.", 404)
        entry = row["data"]
        field = next(field for field in entry["fields"] if field["field_id"] == parts[1])
        if method == "PATCH" and len(parts) == 2:
            return field_change(conn, entry, field, body)
        if method == "POST" and parts[2:] in (["retire"], ["unretire"]):
            field["status"] = "retired" if parts[2] == "retire" else "active"
            return field_change(conn, entry, field, {})
    if len(parts) == 2 and parts[0] == "records":
        row = conn.execute("SELECT * FROM steel_designer.records WHERE id = %s", (parts[1],)).fetchone()
        if row is None:
            raise RequestError("Record not found.", 404)
        entry = get_type(conn, row["type_id"])
        spec = published(entry)
        if method == "GET":
            return {"record": record_view(row, entry, spec)}
        if method == "PATCH":
            values = validate_values(spec["fields"], row["values_data"] | body.get("values", {}))
            check_unique(conn, entry, spec["fields"], values, row["id"])
            row = conn.execute("UPDATE steel_designer.records SET values_data = %s WHERE id = %s RETURNING *",
                               (Jsonb(values), row["id"])).fetchone()
            return {"ok": True, "record": record_view(row, entry, spec)}
        if method == "DELETE":
            if query.get("purge") == "1":
                conn.execute("DELETE FROM steel_designer.records WHERE id = %s", (row["id"],))
            else:
                conn.execute("UPDATE steel_designer.records SET lifecycle = 'deleted' WHERE id = %s", (row["id"],))
            return {"ok": True, "deleted": [row["id"]]}
    raise RequestError("This operation is unavailable in local Data Designer.", 501)


def main():
    try:
        req = json.load(sys.stdin)
        if not isinstance(req["body"], dict):
            raise RequestError("Request body must be an object.")
        parts = [unquote(part) for part in req["path"].split("/")[3:] if part]
        with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=5, row_factory=dict_row) as conn:
            initialize(conn)
            data = handle(conn, req["method"], parts, req["query"], req["body"])
        return 200, data
    except RequestError as error:
        return error.status, error.data
    except ValidationError as error:
        errors = [{"field": ".".join(map(str, item["loc"])), "message": item["msg"]}
                  for item in error.errors(include_input=False, include_context=False)]
        return 422, {"error": "Record validation failed.", "report": {"errors": errors}}
    except psycopg.errors.UniqueViolation:
        return 409, {"error": "That type name is already in use."}
    except psycopg.Error:
        return 503, {"error": "PostgreSQL is unavailable or the Data Designer schema is inaccessible."}
    except (TypeError, ValueError, ArithmeticError):
        return 400, {"error": "Invalid Data Designer parameters."}


if __name__ == "__main__":
    status, data = main()
    print(json.dumps({"status": status, "data": data}))
