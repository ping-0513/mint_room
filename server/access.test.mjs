import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalPaidProviderRequest, isLoopbackAddress } from "./access.mjs";

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

test("IPv4とIPv6のループバックだけをローカルアドレスとして扱う", () => {
  for (const address of ["127.0.0.1", "127.255.255.255", "::1", "::ffff:127.0.0.1", "[::1]"]) {
    assert.equal(isLoopbackAddress(address), true);
  }
  for (const address of ["0.0.0.0", "192.168.0.1", "::", "::ffff:192.168.0.1", "127.0.0.999", ""]) {
    assert.equal(isLoopbackAddress(address), false);
  }
});
