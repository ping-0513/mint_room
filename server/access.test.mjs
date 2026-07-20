import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isJSONContentType,
  isLocalPaidProviderRequest,
  isLoopbackAddress,
  isTrustedPaidProviderRequest,
} from "./access.mjs";

test("APIキー使用時は同じ端末からのリクエストだけ有料APIへ進める", () => {
  assert.equal(isLocalPaidProviderRequest("127.0.0.1", "localhost:3000"), true);
  assert.equal(isLocalPaidProviderRequest("::1", "[::1]:3000"), true);
  assert.equal(isLocalPaidProviderRequest("::ffff:127.0.0.1", "127.0.0.1:3000"), true);
  assert.equal(isLocalPaidProviderRequest("127.0.0.2", "mint-room.localhost:3000"), true);
});

test("LANや公開ホストからのリクエストは有料APIへ進めない", () => {
  assert.equal(isLocalPaidProviderRequest("192.168.1.25", "localhost:3000"), false);
  assert.equal(isLocalPaidProviderRequest("127.0.0.1", "mint-room.example.com"), false);
  assert.equal(isLocalPaidProviderRequest("::1", "not a valid host"), false);
  assert.equal(isLocalPaidProviderRequest(undefined, "localhost:3000"), false);
});

test("APIのContent-Typeはapplication/jsonだけを受け付ける", () => {
  assert.equal(isJSONContentType("application/json"), true);
  assert.equal(isJSONContentType("Application/JSON; charset=UTF-8"), true);
  assert.equal(isJSONContentType("text/plain"), false);
  assert.equal(isJSONContentType("application/x-www-form-urlencoded"), false);
  assert.equal(isJSONContentType(undefined), false);
});

const trustedBase = {
  remoteAddress: "127.0.0.1",
  hostHeader: "localhost:3000",
  contentType: "application/json; charset=utf-8",
};

test("ブラウザ経由は同じlocalhost Originだけを有料APIへ進める", () => {
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, originHeader: "http://localhost:3000" }), true);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, originHeader: "https://attacker.example" }), false);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, originHeader: "http://localhost:4000" }), false);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, originHeader: "https://localhost:3000" }), false);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, originHeader: "null" }), false);
});

test("OriginのないCLI利用は既存のローカル条件とJSON条件を満たす場合だけ許可する", () => {
  assert.equal(isTrustedPaidProviderRequest(trustedBase), true);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, hostHeader: "example.com" }), false);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, remoteAddress: "192.168.1.10" }), false);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, contentType: "text/plain" }), false);
  assert.equal(isTrustedPaidProviderRequest({ ...trustedBase, contentType: "application/x-www-form-urlencoded" }), false);
});

test("ブラウザがcross-siteと明示したリクエストはOrigin文字列に関係なく拒否する", () => {
  assert.equal(
    isTrustedPaidProviderRequest({
      ...trustedBase,
      originHeader: "http://localhost:3000",
      secFetchSite: "cross-site",
    }),
    false
  );
});

test("IPv4とIPv6のループバックだけをローカルアドレスとして扱う", () => {
  for (const address of ["127.0.0.1", "127.255.255.255", "::1", "::ffff:127.0.0.1", "[::1]"]) {
    assert.equal(isLoopbackAddress(address), true);
  }
  for (const address of ["0.0.0.0", "192.168.0.1", "::", "::ffff:192.168.0.1", "127.0.0.999", ""]) {
    assert.equal(isLoopbackAddress(address), false);
  }
});
