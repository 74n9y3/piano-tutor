import assert from "node:assert/strict";
import { decideFollow, decideFollowNote, initialListen } from "../frontend/src/follow.ts";

function feed(midi: number | null, times: number, target = 60, next: number | null = 62) {
  let state = initialListen();
  let last = decideFollow(state, target, next, midi);
  for (let i = 1; i < times; i += 1) {
    last = decideFollow(last.state, target, next, midi);
  }
  return last;
}

const first = feed(60, 3);
assert.equal(first.action, "wait");
const advanced = feed(60, 4);
assert.equal(advanced.action, "advance");

const held = decideFollow(advanced.state, 62, 64, 60);
assert.equal(held.action, "wait");

let wrong = advanced.state;
let decision = decideFollow(wrong, 62, 64, 64);
for (let i = 0; i < 3; i += 1) decision = decideFollow(decision.state, 62, 64, 64);
assert.equal(decision.action, "wrong");
const again = decideFollow(decision.state, 62, 64, 64);
assert.equal(again.action, "wait");

let repeated = decideFollow(initialListen(), 60, 60, 60);
for (let i = 0; i < 3; i += 1) repeated = decideFollow(repeated.state, 60, 60, 60);
assert.equal(repeated.action, "advance");
assert.match(repeated.hint ?? "", /松开/);
let quiet = repeated;
for (let i = 0; i < 3; i += 1) quiet = decideFollow(quiet.state, 60, 60, null);
assert.equal(quiet.state.latched, null);
let second = quiet;
for (let i = 0; i < 4; i += 1) second = decideFollow(second.state, 60, 60, 60);
assert.equal(second.action, "advance");

const tapped = decideFollowNote(60, 62, 60);
assert.equal(tapped.action, "advance");
assert.equal(tapped.heard, 60);

const mistap = decideFollowNote(60, 62, 62);
assert.equal(mistap.action, "wrong");
assert.equal(mistap.heard, 62);
assert.equal(mistap.hint, null);

const chordTone = decideFollowNote(60, 64, 64);
assert.equal(chordTone.action, "wrong");
const chordTarget = decideFollowNote(60, 64, 60);
assert.equal(chordTarget.action, "advance");

const repeatedTap = decideFollowNote(60, 60, 60);
assert.equal(repeatedTap.action, "advance");
assert.match(repeatedTap.hint ?? "", /松开/);

console.log("follow decisions ok");
