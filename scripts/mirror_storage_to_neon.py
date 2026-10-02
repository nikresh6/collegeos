#!/usr/bin/env python3
"""Checksum-verified Supabase Storage mirror to Neon Object Storage.

The script never deletes source objects. Run without --execute to inventory the
source. With --execute, every object is downloaded, hashed, uploaded to the
private Neon bucket, and verified with HeadObject before a manifest is written.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    boto3 = None
    ClientError = Exception


RETRYABLE = {408, 425, 429, 500, 502, 503, 504}
MAX_ATTEMPTS = 6
PAGE_SIZE = 100


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    timeout: int = 180,
) -> tuple[bytes, dict[str, str]]:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        req = urllib.request.Request(url, method=method, headers=headers or {}, data=data)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                return response.read(), {key.lower(): value for key, value in response.headers.items()}
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if error.code not in RETRYABLE or attempt == MAX_ATTEMPTS:
                raise RuntimeError(f"{method} {url} failed ({error.code}): {detail}") from error
            time.sleep(min(2 ** (attempt - 1), 16))
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == MAX_ATTEMPTS:
                raise RuntimeError(f"{method} {url} failed after {attempt} attempts: {error}") from error
            time.sleep(min(2 ** (attempt - 1), 16))
    raise RuntimeError("HTTP retry budget exhausted")


class SupabaseStorage:
    def __init__(self) -> None:
        self.base = required_env("SUPABASE_URL").rstrip("/")
        self.key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip() or required_env("SUPABASE_SECRET_KEY")

    @property
    def headers(self) -> dict[str, str]:
        return {
            "apikey": self.key,
            "authorization": f"Bearer {self.key}",
            "content-type": "application/json",
        }

    def list_page(self, bucket: str, prefix: str, offset: int) -> list[dict[str, Any]]:
        payload = {
            "prefix": prefix,
            "limit": PAGE_SIZE,
            "offset": offset,
            "sortBy": {"column": "name", "order": "asc"},
        }
        body, _ = request(
            f"{self.base}/storage/v1/object/list/{urllib.parse.quote(bucket, safe='')}",
            method="POST",
            headers=self.headers,
            data=json.dumps(payload).encode(),
        )
        value = json.loads(body)
        if not isinstance(value, list):
            raise RuntimeError(f"Unexpected object listing for {bucket}/{prefix}")
        return value

    def objects(self, bucket: str, prefix: str = "") -> Iterator[dict[str, Any]]:
        offset = 0
        while True:
            page = self.list_page(bucket, prefix, offset)
            for item in page:
                name = str(item.get("name") or "")
                if not name:
                    continue
                key = f"{prefix}/{name}".strip("/")
                if item.get("id"):
                    yield {"bucket": bucket, "key": key, "metadata": item.get("metadata") or {}}
                else:
                    yield from self.objects(bucket, key)
            if len(page) < PAGE_SIZE:
                return
            offset += PAGE_SIZE

    def download(self, bucket: str, key: str, destination: Path) -> None:
        encoded = urllib.parse.quote(key, safe="/")
        body, _ = request(
            f"{self.base}/storage/v1/object/authenticated/{urllib.parse.quote(bucket, safe='')}/{encoded}",
            headers=self.headers,
            timeout=300,
        )
        destination.write_bytes(body)


class NeonStorage:
    def __init__(self) -> None:
        if boto3 is None:
            raise RuntimeError("Install requirements/archive.txt before using --execute")
        self.bucket = required_env("NEON_ARCHIVE_BUCKET")
        self.client = boto3.client(
            "s3",
            endpoint_url=required_env("AWS_ENDPOINT_URL_S3"),
            region_name=os.environ.get("AWS_REGION", "").strip() or "us-east-2",
            aws_access_key_id=required_env("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=required_env("AWS_SECRET_ACCESS_KEY"),
        )

    def mirror(
        self,
        source_bucket: str,
        source_key: str,
        path: Path,
        digest: str,
        content_type: str,
    ) -> tuple[str, bool]:
        target_key = f"supabase-storage/{source_bucket}/{source_key}"
        try:
            head = self.client.head_object(Bucket=self.bucket, Key=target_key)
            metadata = head.get("Metadata") or {}
            if metadata.get("sha256") == digest and int(head.get("ContentLength", -1)) == path.stat().st_size:
                return target_key, False
        except ClientError as error:
            status = int(error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0))
            if status != 404:
                raise

        self.client.upload_file(
            str(path),
            self.bucket,
            target_key,
            ExtraArgs={
                "ContentType": content_type,
                "Metadata": {"sha256": digest, "source-bucket": source_bucket},
            },
        )
        head = self.client.head_object(Bucket=self.bucket, Key=target_key)
        if int(head.get("ContentLength", -1)) != path.stat().st_size:
            raise RuntimeError(f"Neon size verification failed for {target_key}")
        if (head.get("Metadata") or {}).get("sha256") != digest:
            raise RuntimeError(f"Neon SHA-256 metadata verification failed for {target_key}")
        return target_key, True

    def upload_manifest(self, manifest: dict[str, Any]) -> str:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        key = f"migration-manifests/collegeos-storage-{stamp}.json"
        payload = json.dumps(manifest, indent=2, sort_keys=True).encode()
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=payload,
            ContentType="application/json",
            Metadata={"sha256": hashlib.sha256(payload).hexdigest()},
        )
        return key


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Mirror CollegeOS Supabase Storage into Neon")
    parser.add_argument(
        "--buckets",
        default=os.environ.get("SUPABASE_STORAGE_BUCKETS", "course-files,lecture-audio"),
        help="Comma-separated Supabase bucket names",
    )
    parser.add_argument("--execute", action="store_true", help="Upload and verify objects in Neon")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    buckets = [value.strip() for value in args.buckets.split(",") if value.strip()]
    if not buckets:
        raise RuntimeError("At least one storage bucket is required")

    source = SupabaseStorage()
    inventory = [item for bucket in buckets for item in source.objects(bucket)]
    if not args.execute:
        print(json.dumps({"ok": True, "dry_run": True, "objects": len(inventory), "buckets": buckets}, indent=2))
        return 0

    target = NeonStorage()
    records: list[dict[str, Any]] = []
    uploaded = 0
    with tempfile.TemporaryDirectory(prefix="collegeos-neon-mirror-") as temporary:
        directory = Path(temporary)
        for index, item in enumerate(inventory):
            path = directory / f"object-{index}"
            source.download(item["bucket"], item["key"], path)
            digest = sha256_file(path)
            content_type = str(item["metadata"].get("mimetype") or "application/octet-stream")
            target_key, changed = target.mirror(
                item["bucket"],
                item["key"],
                path,
                digest,
                content_type,
            )
            uploaded += int(changed)
            records.append(
                {
                    "source_bucket": item["bucket"],
                    "source_key": item["key"],
                    "target_key": target_key,
                    "byte_count": path.stat().st_size,
                    "sha256": digest,
                    "content_type": content_type,
                    "uploaded": changed,
                }
            )

    manifest = {
        "schema_version": "collegeos-storage-mirror-v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": "supabase_storage",
        "target": "neon_object_storage",
        "target_bucket": target.bucket,
        "objects": records,
        "object_count": len(records),
        "byte_count": sum(int(record["byte_count"]) for record in records),
        "uploaded_count": uploaded,
        "source_deleted": False,
    }
    manifest_key = target.upload_manifest(manifest)
    print(json.dumps({"ok": True, "manifest_key": manifest_key, **{key: manifest[key] for key in ("object_count", "byte_count", "uploaded_count")}}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        raise
