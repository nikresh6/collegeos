import { createHash, createHmac } from "node:crypto";

type StorageMethod = "GET" | "PUT" | "HEAD" | "DELETE";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(bucket: string, key: string) {
  const segments = [bucket, ...key.split("/")].map(awsEncode);
  return `/${segments.join("/")}`;
}

function hmac(
  key: string | Buffer,
  value: string,
) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function presignNeonStorageUrl({
  method,
  bucket,
  key,
  expires = 3600,
}: {
  method: StorageMethod;
  bucket: string;
  key: string;
  expires?: number;
}) {
  const endpoint = new URL(required("AWS_ENDPOINT_URL_S3"));
  const accessKey = required("AWS_ACCESS_KEY_ID");
  const secretKey = required("AWS_SECRET_ACCESS_KEY");
  const region = process.env.AWS_REGION?.trim() || "us-east-2";
  const now = new Date();
  const amzDate = now
    .toISOString()
    .replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const signedHeaders = "host";
  const path = canonicalPath(bucket, key);
  const queryEntries = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKey}/${scope}`],
    ["X-Amz-Date", amzDate],
    [
      "X-Amz-Expires",
      String(Math.max(1, Math.min(604800, Math.round(expires)))),
    ],
    ["X-Amz-SignedHeaders", signedHeaders],
  ]
    .map(([name, value]) => [awsEncode(name), awsEncode(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  const canonicalQuery = queryEntries
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  const canonicalHeaders = `host:${endpoint.host}\n`;
  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${endpoint.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
