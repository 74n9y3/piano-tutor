import assert from "node:assert/strict";
import { stripFilenameMovementTitle } from "../frontend/src/scoreXml.ts";

const xml = `<work><work-title>Scarborough Fair</work-title></work>
<movement-title>score.musicxml</movement-title>
<movement-title>Andante</movement-title>`;

const cleaned = stripFilenameMovementTitle(xml);
assert.equal(cleaned.includes("score.musicxml"), false);
assert.equal(cleaned.includes("<work-title>Scarborough Fair</work-title>"), true);
assert.equal(cleaned.includes("<movement-title>Andante</movement-title>"), true);
console.log("filename subtitle stripped");
