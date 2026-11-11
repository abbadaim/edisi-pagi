import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetFollowUps } from "../src/core/newsroom/selection.ts";

function item(topicId: string, followUp: boolean) {
  return { topicId, followUp };
}

test("tindak lanjut tidak mengambil seluruh kuota", () => {
  const selected = [
    item("f1", true),
    item("f2", true),
    item("f3", true),
    item("f4", true),
    item("f5", true),
  ];
  const pool = [item("n1", false), item("n2", false), item("n3", false)];
  const out = budgetFollowUps(selected, pool, { maxFollow: 2, minFresh: 3, target: 6 });
  assert.equal(out.filter((x) => x.followUp).length, 2);
  assert.equal(out.filter((x) => !x.followUp).length, 3);
});

test("bila berita baru kurang, tindak lanjut tidak melebihi berita baru", () => {
  const selected = [item("n1", false), item("n2", false), item("f1", true), item("f2", true), item("f3", true)];
  const out = budgetFollowUps(selected, [], { maxFollow: 2, minFresh: 3, target: 6 });
  assert.equal(out.filter((x) => !x.followUp).length, 2);
  assert.equal(out.filter((x) => x.followUp).length, 2);
});

test("nol berita baru berarti nol tindak lanjut", () => {
  const selected = [item("f1", true), item("f2", true), item("f3", true)];
  const out = budgetFollowUps(selected, [], { maxFollow: 2, minFresh: 3, target: 6 });
  assert.equal(out.length, 0);
});

test("kuota lokal lebih ketat", () => {
  const selected = [item("n1", false), item("f1", true), item("f2", true)];
  const out = budgetFollowUps(selected, [], { maxFollow: 1, minFresh: 1, target: 4 });
  assert.equal(out.filter((x) => !x.followUp).length, 1);
  assert.equal(out.filter((x) => x.followUp).length, 1);
});
