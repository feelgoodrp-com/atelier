/** Pure operation-diff checks for the realtime client bridge. */

import { createDrawable, createEmptyProject } from "@/lib/project/schema";
import { ApiError } from "./api-client";
import {
  diffWorkspaceProjects,
  shouldRetryWorkspaceRequest,
  toWorkspaceProject,
} from "./live";

let passed = 0;
const check = (name: string, condition: boolean) => {
  if (!condition) throw new Error(`live client selftest failed: ${name}`);
  passed++;
  console.log(`  ok  ${name}`);
};

const before = createEmptyProject("Before");
const after = structuredClone(before);
after.name = "After";
after.settings.defaultGender = "female";
after.drawables.push(
  createDrawable({
    label: "Top",
    gender: "male",
    kind: "component",
    type: "jbib",
  }),
);

const operation = diffWorkspaceProjects(
  toWorkspaceProject(before),
  toWorkspaceProject(after),
);
check("multi-field edit becomes a batch", operation?.kind === "batch");
if (!operation || operation.kind !== "batch") throw new Error("expected batch");

const projectPatch = operation.operations.find((item) => item.kind === "project.patch");
check(
  "project settings use a nested field patch",
  projectPatch?.kind === "project.patch" &&
    projectPatch.patch.name === "After" &&
    projectPatch.patch.settings?.defaultGender === "female" &&
    projectPatch.patch.settings.dlcName === undefined,
);
check(
  "new drawable uses a stable-id upsert",
  operation.operations.some(
    (item) =>
      item.kind === "entity.upsert" &&
      item.entityType === "drawable" &&
      item.entity.id === after.drawables[0]!.id,
  ),
);

const reorderedBefore = toWorkspaceProject(after);
const reorderedAfter = structuredClone(reorderedBefore);
reorderedAfter.drawables.push(
  toWorkspaceProject({
    ...after,
    drawables: [
      createDrawable({
        label: "Second",
        gender: "male",
        kind: "component",
        type: "jbib",
      }),
    ],
  }).drawables[0]!,
);
reorderedAfter.drawables.reverse();
const reorder = diffWorkspaceProjects(reorderedBefore, reorderedAfter);
const reorderLeaves = reorder?.kind === "batch" ? reorder.operations : reorder ? [reorder] : [];
check(
  "drawable order is explicit",
  reorderLeaves.some(
    (item) =>
      item.kind === "order.set" &&
      item.ids.join(",") === reorderedAfter.drawables.map((drawable) => drawable.id).join(","),
  ),
);

const deleted = structuredClone(reorderedAfter);
const deletedId = deleted.drawables[0]!.id;
deleted.drawables.shift();
const deletion = diffWorkspaceProjects(reorderedAfter, deleted);
const deletionLeaves = deletion?.kind === "batch" ? deletion.operations : deletion ? [deletion] : [];
check(
  "deletion is transmitted explicitly",
  deletionLeaves.some(
    (item) => item.kind === "entity.delete" && item.id === deletedId,
  ),
);

check(
  "temporary workspace contention keeps the durable operation queued",
  shouldRetryWorkspaceRequest(
    new ApiError("workspace_busy", 409, { error: "workspace_busy" }),
  ),
);
check(
  "a foreign lock is a final rejection for that optimistic operation",
  !shouldRetryWorkspaceRequest(new ApiError("locked", 409, { error: "locked" })),
);
check(
  "missing CAS assets are uploaded and retried instead of discarded",
  shouldRetryWorkspaceRequest(
    new ApiError("missing_assets", 400, { error: "missing_assets", missing: [] }),
  ),
);

console.log(`All ${passed} live client checks passed.`);
