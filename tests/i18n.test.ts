import assert from "node:assert/strict";
import { dictionaries } from "../frontend/src/i18n.ts";

const packs = dictionaries();
const zh = Object.keys(packs["zh-CN"]).sort();
const en = Object.keys(packs.en).sort();
assert.deepEqual(zh, en);
console.log("i18n keys match");
