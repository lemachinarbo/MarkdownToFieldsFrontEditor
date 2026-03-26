import { Extension, Mark } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Bold from "@tiptap/extension-bold";
import BulletList from "@tiptap/extension-bullet-list";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { inlineHtmlTags } from "./editor-core.js";
import { computeChangedRanges } from "./markdown-text-utils.js";
import {
  getDefaultBoldDelimiter,
  getDefaultItalicDelimiter,
  getDefaultUnorderedListMarker,
} from "./markdown-style-preferences.js";

function updateNearestNodeAttrsForSelection(
  selection,
  tr,
  nodeTypeName,
  attrs,
) {
  if (!selection || !tr) return false;
  let target = null;

  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    if (node?.type?.name !== nodeTypeName) continue;
    target = {
      node,
      pos: selection.$from.before(depth),
    };
    break;
  }

  if (!target) return false;

  tr.setNodeMarkup(target.pos, undefined, {
    ...(target.node?.attrs || {}),
    ...(attrs || {}),
  });
  return true;
}

function buildNodeMatchKey(node) {
  if (!node) return "null";
  const typeName = String(node.type?.name || "");
  const attrs = node?.attrs || {};
  const attrsKey = JSON.stringify(
    Object.keys(attrs)
      .sort()
      .reduce((acc, key) => {
        if (key === "id") return acc;
        acc[key] = attrs[key];
        return acc;
      }, {}),
  );
  return `${typeName}:${attrsKey}`;
}

function nodesAreComparable(snapshotNode, baseNode) {
  if (!snapshotNode || !baseNode) return false;
  if (snapshotNode.type?.name !== baseNode.type?.name) return false;
  if (snapshotNode.type?.name === "image") return true;
  if (snapshotNode.isTextblock && baseNode.isTextblock) return true;
  return buildNodeMatchKey(snapshotNode) === buildNodeMatchKey(baseNode);
}

function diffNodeSequences(snapshotNodes, baseNodes) {
  const dp = Array.from({ length: snapshotNodes.length + 1 }, () =>
    Array(baseNodes.length + 1).fill(0),
  );

  for (let i = snapshotNodes.length - 1; i >= 0; i -= 1) {
    for (let j = baseNodes.length - 1; j >= 0; j -= 1) {
      if (nodesAreComparable(snapshotNodes[i], baseNodes[j])) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < snapshotNodes.length && j < baseNodes.length) {
    if (nodesAreComparable(snapshotNodes[i], baseNodes[j])) {
      ops.push({
        type: "common",
        snapshotIndex: i,
        baseIndex: j,
      });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({
        type: "add",
        snapshotIndex: i,
      });
      i += 1;
      continue;
    }
    ops.push({
      type: "remove",
      baseIndex: j,
    });
    j += 1;
  }
  while (i < snapshotNodes.length) {
    ops.push({
      type: "add",
      snapshotIndex: i,
    });
    i += 1;
  }
  while (j < baseNodes.length) {
    ops.push({
      type: "remove",
      baseIndex: j,
    });
    j += 1;
  }
  return ops;
}

function createRemovedWidget(text, block = false) {
  return () => {
    const el = document.createElement(block ? "div" : "span");
    el.className = block
      ? "mfe-snapshot-compare-removed-block"
      : "mfe-snapshot-compare-inline-removed";
    el.textContent = String(text || "");
    return el;
  };
}

function createRemovedImageWidget(node) {
  return () => {
    const wrap = document.createElement("div");
    wrap.className =
      "mfe-snapshot-compare-removed-block mfe-snapshot-compare-image-removed";
    const badge = document.createElement("span");
    badge.className =
      "mfe-snapshot-compare-node-badge mfe-snapshot-compare-node-badge--removed";
    badge.textContent = "Removed image";
    wrap.appendChild(badge);
    const src = String(node?.attrs?.src || "");
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = String(node?.attrs?.alt || "");
      wrap.appendChild(img);
    }
    return wrap;
  };
}

function getImageComparableAttrs(node) {
  return {
    src: String(node?.attrs?.src || ""),
    alt: String(node?.attrs?.alt || ""),
    title: String(node?.attrs?.title || ""),
  };
}

function imageAttrsEqual(snapshotNode, baseNode) {
  return (
    JSON.stringify(getImageComparableAttrs(snapshotNode)) ===
    JSON.stringify(getImageComparableAttrs(baseNode))
  );
}

function collectNonTextChildEntries(node, parentPos) {
  const entries = [];
  if (!node || !node.childCount) return entries;
  let offset = 0;
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (!child?.isText) {
      entries.push({
        node: child,
        pos: parentPos + offset,
      });
    }
    offset += child.nodeSize;
  }
  return entries;
}

function collectLinkMarkEntries(node, textblockPos) {
  const entries = [];
  if (!node?.descendants) return entries;
  node.descendants((child, pos) => {
    if (!child?.isText) return;
    const linkMark = child.marks?.find((mark) => mark?.type?.name === "link");
    if (!linkMark) return;
    const text = String(child.text || "");
    if (!text) return;
    const from = textblockPos + 1 + pos;
    const to = from + text.length;
    const href = String(linkMark.attrs?.href || "");
    const last = entries[entries.length - 1] || null;
    if (last && last.href === href && last.to === from) {
      last.to = to;
      last.text += text;
      return;
    }
    entries.push({
      from,
      to,
      text,
      href,
    });
  });
  return entries;
}

function buildLinkEntryKey(entry, textblockPos) {
  if (!entry) return "";
  const from = Math.max(0, Number(entry.from || 0) - Number(textblockPos || 0));
  const to = Math.max(0, Number(entry.to || 0) - Number(textblockPos || 0));
  return `${from}:${to}:${String(entry.text || "")}`;
}

function createInlineNoteWidget(text, tone = "edited") {
  return () => {
    const el = document.createElement("span");
    el.className = `mfe-snapshot-compare-inline-note mfe-snapshot-compare-inline-note--${tone}`;
    el.textContent = String(text || "");
    return el;
  };
}

function formatLinkTargetForCompare(href) {
  const value = String(href || "").trim();
  if (!value) return "empty";
  if (value.length <= 48) return value;
  return `${value.slice(0, 45)}...`;
}

function formatLinkEntityForCompare(text, href) {
  const label = String(text || "").trim();
  const target = String(href || "").trim();
  if (label && target) {
    return `${label} ${formatLinkTargetForCompare(target)}`;
  }
  if (label) return label;
  if (target) return formatLinkTargetForCompare(target);
  return "";
}

function createReplacementWidget(beforeText, afterText) {
  return () => {
    const wrap = document.createElement("span");
    wrap.className = "mfe-snapshot-compare-replacement";
    const beforeValue = String(beforeText || "");
    const afterValue = String(afterText || "");
    if (beforeValue) {
      const before = document.createElement("span");
      before.className = "mfe-snapshot-compare-inline-removed";
      before.textContent = beforeValue;
      wrap.appendChild(before);
    }
    if (beforeValue && afterValue) {
      wrap.appendChild(document.createTextNode(" "));
    }
    if (afterValue) {
      const after = document.createElement("span");
      after.className = "mfe-snapshot-compare-inline-added";
      after.textContent = afterValue;
      wrap.appendChild(after);
    }
    return wrap;
  };
}

export const MarkerAwareBold = Bold.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      delimiter: {
        default: getDefaultBoldDelimiter(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      setBold:
        () =>
        ({ commands }) =>
          commands.setMark(this.name, {
            delimiter: getDefaultBoldDelimiter(),
          }),
      toggleBold:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name, {
            delimiter: getDefaultBoldDelimiter(),
          }),
      unsetBold:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const MarkerAwareItalic = Italic.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      delimiter: {
        default: getDefaultItalicDelimiter(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      setItalic:
        () =>
        ({ commands }) =>
          commands.setMark(this.name, {
            delimiter: getDefaultItalicDelimiter(),
          }),
      toggleItalic:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name, {
            delimiter: getDefaultItalicDelimiter(),
          }),
      unsetItalic:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

export const MarkerAwareBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      bullet: {
        default: getDefaultUnorderedListMarker(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      toggleBulletList:
        () =>
        ({ chain }) =>
          chain()
            .toggleList(
              this.name,
              this.options.itemTypeName,
              this.options.keepMarks,
            )
            .command(({ tr }) => {
              return updateNearestNodeAttrsForSelection(
                tr.selection,
                tr,
                this.name,
                {
                  bullet: getDefaultUnorderedListMarker(),
                },
              );
            })
            .run(),
    };
  },
});

export const MarkerAwareTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      bullet: {
        default: getDefaultUnorderedListMarker(),
      },
    };
  },
  addCommands() {
    return {
      ...(this.parent?.() || {}),
      toggleTaskList:
        () =>
        ({ chain }) =>
          chain()
            .toggleList(this.name, this.options.itemTypeName)
            .command(({ tr }) => {
              return updateNearestNodeAttrsForSelection(
                tr.selection,
                tr,
                this.name,
                {
                  bullet: getDefaultUnorderedListMarker(),
                },
              );
            })
            .run(),
    };
  },
});

export const InlineHtmlLabelExtension = Extension.create({
  name: "inlineHtmlLabel",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations = [];
            state.doc.descendants((node, pos, parent) => {
              if (!node.isText) return;
              if (parent?.type?.name === "codeBlock") return;
              if (node.marks?.some((mark) => mark.type.name === "code")) return;

              inlineHtmlTags.forEach((tag) => {
                const re = new RegExp(`<\\s*\\/?\\s*${tag}\\b[^>]*>`, "gi");
                let match;
                while ((match = re.exec(node.text)) !== null) {
                  const from = pos + match.index;
                  const to = from + match[0].length;
                  decorations.push(
                    Decoration.inline(from, to, {
                      class: "mfe-inline-html",
                      "data-inline-html": match[0],
                    }),
                  );
                }
              });
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});

export function createSnapshotCompareExtension(getCompareData) {
  return Extension.create({
    name: "snapshotCompare",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              const compare =
                typeof getCompareData === "function" ? getCompareData() : null;
              const baseDoc = compare?.baseDoc || null;
              if (!baseDoc || !state?.doc) {
                return DecorationSet.empty;
              }

              const decorations = [];
              const decorateInlineAddedRange = (from, to) => {
                if (to <= from) return;
                decorations.push(
                  Decoration.inline(from, to, {
                    class: "mfe-snapshot-compare-inline-added",
                  }),
                );
              };

              const decorateTextblockDiff = (
                snapshotNode,
                baseNode,
                snapshotPos,
              ) => {
                const snapshotText = String(snapshotNode?.textContent || "");
                const currentText = String(baseNode?.textContent || "");
                if (snapshotText === currentText) {
                  return;
                }
                const changedRanges = computeChangedRanges(
                  currentText,
                  snapshotText,
                );
                changedRanges.forEach((range) => {
                  const start = Number(range?.start || 0);
                  const afterBytes = Number(range?.afterBytes || 0);
                  const beforeBytes = Number(range?.beforeBytes || 0);
                  const inlineAnchor = snapshotPos + 1 + start;
                  if (beforeBytes > 0) {
                    const deletedText = currentText.slice(
                      start,
                      start + beforeBytes,
                    );
                    if (deletedText) {
                      decorations.push(
                        Decoration.widget(
                          inlineAnchor,
                          createRemovedWidget(deletedText, false),
                          { side: -1 },
                        ),
                      );
                    }
                  }
                  if (afterBytes > 0) {
                    const inlineTo = inlineAnchor + afterBytes;
                    decorateInlineAddedRange(inlineAnchor, inlineTo);
                  }
                });
              };

              const decorateLinkDiffsInTextblock = (
                snapshotNode,
                baseNode,
                snapshotPos,
              ) => {
                const snapshotLinks = collectLinkMarkEntries(
                  snapshotNode,
                  snapshotPos,
                );
                const baseLinks = collectLinkMarkEntries(baseNode, snapshotPos);
                if (!snapshotLinks.length && !baseLinks.length) {
                  return;
                }
                const baseByKey = new Map();
                baseLinks.forEach((entry) => {
                  baseByKey.set(buildLinkEntryKey(entry, snapshotPos), entry);
                });
                const seenBaseKeys = new Set();
                const unmatchedSnapshotLinks = [];
                const unmatchedBaseLinks = [];
                const snapshotText = String(snapshotNode?.textContent || "");
                const baseText = String(baseNode?.textContent || "");

                snapshotLinks.forEach((snapshotLink) => {
                  const key = buildLinkEntryKey(snapshotLink, snapshotPos);
                  const baseLink = baseByKey.get(key) || null;
                  if (!baseLink) {
                    unmatchedSnapshotLinks.push(snapshotLink);
                    return;
                  }
                  seenBaseKeys.add(key);
                  if (snapshotLink.href === baseLink.href) return;
                  decorations.push(
                    Decoration.inline(snapshotLink.from, snapshotLink.to, {
                      class: "mfe-snapshot-compare-inline-added",
                    }),
                  );
                  decorations.push(
                    Decoration.widget(
                      snapshotLink.from,
                      createReplacementWidget(
                        formatLinkEntityForCompare(baseLink.text, baseLink.href),
                        "",
                      ),
                      { side: -1 },
                    ),
                  );
                });

                baseLinks.forEach((baseLink) => {
                  const key = buildLinkEntryKey(baseLink, snapshotPos);
                  if (seenBaseKeys.has(key)) return;
                  unmatchedBaseLinks.push(baseLink);
                });

                const pairCount = Math.min(
                  unmatchedSnapshotLinks.length,
                  unmatchedBaseLinks.length,
                );
                for (let index = 0; index < pairCount; index += 1) {
                  const snapshotLink = unmatchedSnapshotLinks[index];
                  const baseLink = unmatchedBaseLinks[index];
                  if (!snapshotLink || !baseLink) continue;
                  decorations.push(
                    Decoration.inline(snapshotLink.from, snapshotLink.to, {
                      class: "mfe-snapshot-compare-inline-added",
                    }),
                  );
                  decorations.push(
                    Decoration.widget(
                      snapshotLink.from,
                      createReplacementWidget(
                        formatLinkEntityForCompare(baseLink.text, baseLink.href),
                        "",
                      ),
                      { side: -1 },
                    ),
                  );
                }

                unmatchedSnapshotLinks.slice(pairCount).forEach((snapshotLink) => {
                  const start = Math.max(
                    0,
                    Number(snapshotLink.from || 0) - (snapshotPos + 1),
                  );
                  const end = Math.max(
                    start,
                    Number(snapshotLink.to || 0) - (snapshotPos + 1),
                  );
                  const previousText = baseText.slice(start, end);
                  decorations.push(
                    Decoration.inline(snapshotLink.from, snapshotLink.to, {
                      class: "mfe-snapshot-compare-inline-added",
                    }),
                  );
                  decorations.push(
                    Decoration.widget(
                      snapshotLink.from,
                      createReplacementWidget(
                        previousText,
                        "",
                      ),
                      { side: -1 },
                    ),
                  );
                });

                unmatchedBaseLinks.slice(pairCount).forEach((baseLink) => {
                  const start = Math.max(
                    0,
                    Number(baseLink.from || 0) - (snapshotPos + 1),
                  );
                  const end = Math.max(
                    start,
                    Number(baseLink.to || 0) - (snapshotPos + 1),
                  );
                  const nextFrom = snapshotPos + 1 + start;
                  const nextTo = snapshotPos + 1 + end;
                  if (nextTo > nextFrom) {
                    decorations.push(
                      Decoration.inline(nextFrom, nextTo, {
                        class: "mfe-snapshot-compare-inline-added",
                      }),
                    );
                  }
                  const anchor = Math.min(
                    snapshotPos + 1 + snapshotText.length,
                    Math.max(snapshotPos + 1, nextFrom),
                  );
                  decorations.push(
                    Decoration.widget(
                      anchor,
                      createReplacementWidget(
                        formatLinkEntityForCompare(baseLink.text, baseLink.href),
                        "",
                      ),
                      { side: -1 },
                    ),
                  );
                });
              };

              const decorateAddedSubtree = (snapshotNode, nodePos) => {
                if (!snapshotNode) return;
                const nodeType = String(snapshotNode.type?.name || "");
                if (nodeType === "image") {
                  decorations.push(
                    Decoration.widget(
                      nodePos + snapshotNode.nodeSize,
                      createInlineNoteWidget(
                        formatLinkTargetForCompare(snapshotNode?.attrs?.src || ""),
                        "added",
                      ),
                      {
                        side: 1,
                      },
                    ),
                  );
                  decorations.push(
                    Decoration.node(nodePos, nodePos + snapshotNode.nodeSize, {
                      class:
                        "mfe-snapshot-compare-image mfe-snapshot-compare-image--added",
                    }),
                  );
                  return;
                }
                if (nodeType === "taskItem") {
                  decorations.push(
                    Decoration.node(nodePos, nodePos + snapshotNode.nodeSize, {
                      class:
                        "mfe-snapshot-compare-task-item mfe-snapshot-compare-task-item--added mfe-snapshot-compare-task-toggle--added",
                    }),
                  );
                }
                if (snapshotNode.isTextblock) {
                  const text = String(snapshotNode.textContent || "");
                  if (text) {
                    decorateInlineAddedRange(
                      nodePos + 1,
                      nodePos + 1 + text.length,
                    );
                  }
                  return;
                }
                if (snapshotNode.childCount > 0) {
                  let childOffset = 0;
                  for (
                    let index = 0;
                    index < snapshotNode.childCount;
                    index += 1
                  ) {
                    const child = snapshotNode.child(index);
                    decorateAddedSubtree(child, nodePos + 1 + childOffset);
                    childOffset += child.nodeSize;
                  }
                  return;
                }
                decorations.push(
                  Decoration.node(nodePos, nodePos + snapshotNode.nodeSize, {
                    class:
                      "mfe-snapshot-compare-block mfe-snapshot-compare-block--snapshot-only",
                  }),
                );
              };

              const decorateRemovedNode = (baseNode, anchorPos) => {
                if (!baseNode) return;
                const nodeType = String(baseNode.type?.name || "");
                if (nodeType === "image") {
                  decorations.push(
                    Decoration.widget(
                      anchorPos,
                      createRemovedImageWidget(baseNode),
                      {
                        side: -1,
                      },
                    ),
                  );
                  return;
                }
                const removedText = String(baseNode?.textContent || "").trim();
                if (removedText) {
                  decorations.push(
                    Decoration.widget(
                      anchorPos,
                      createRemovedWidget(removedText, true),
                      {
                        side: -1,
                      },
                    ),
                  );
                }
              };

              const decorateImageDiff = (snapshotNode, baseNode, nodePos) => {
                if (imageAttrsEqual(snapshotNode, baseNode)) {
                  return;
                }
                decorations.push(
                  Decoration.widget(
                    nodePos + snapshotNode.nodeSize,
                    createReplacementWidget(
                      formatLinkTargetForCompare(baseNode?.attrs?.src || ""),
                      formatLinkTargetForCompare(snapshotNode?.attrs?.src || ""),
                    ),
                    {
                      side: 1,
                    },
                  ),
                );
                decorations.push(
                  Decoration.node(nodePos, nodePos + snapshotNode.nodeSize, {
                    class:
                      "mfe-snapshot-compare-image mfe-snapshot-compare-image--edited",
                  }),
                );
              };

              const decorateTaskItemDiff = (
                snapshotNode,
                baseNode,
                nodePos,
              ) => {
                const snapshotChecked = Boolean(snapshotNode?.attrs?.checked);
                const baseChecked = Boolean(baseNode?.attrs?.checked);
                if (snapshotChecked !== baseChecked) {
                  decorations.push(
                    Decoration.node(nodePos, nodePos + snapshotNode.nodeSize, {
                      class: `mfe-snapshot-compare-task-item mfe-snapshot-compare-task-toggle--${snapshotChecked ? "added" : "removed"}`,
                    }),
                  );
                }
              };

              const compareNonTextChildrenInTextblock = (
                snapshotNode,
                baseNode,
                snapshotPos,
              ) => {
                const snapshotEntries = collectNonTextChildEntries(
                  snapshotNode,
                  snapshotPos + 1,
                );
                const baseEntries = collectNonTextChildEntries(
                  baseNode,
                  snapshotPos + 1,
                );
                if (!snapshotEntries.length && !baseEntries.length) {
                  return;
                }
                const ops = diffNodeSequences(
                  snapshotEntries.map((entry) => entry.node),
                  baseEntries.map((entry) => entry.node),
                );
                let cursor = snapshotPos + 1;
                ops.forEach((op) => {
                  if (op.type === "add") {
                    const entry = snapshotEntries[op.snapshotIndex];
                    decorateAddedSubtree(entry?.node, entry?.pos);
                    cursor =
                      (entry?.pos || cursor) + (entry?.node?.nodeSize || 0);
                    return;
                  }
                  if (op.type === "remove") {
                    const entry = baseEntries[op.baseIndex];
                    decorateRemovedNode(entry?.node, cursor);
                    return;
                  }
                  const snapshotEntry = snapshotEntries[op.snapshotIndex];
                  const baseEntry = baseEntries[op.baseIndex];
                  const childNode = snapshotEntry?.node || null;
                  const baseChildNode = baseEntry?.node || null;
                  const childPos = snapshotEntry?.pos || cursor;
                  cursor = childPos + (childNode?.nodeSize || 0);
                  if (!childNode || !baseChildNode) return;
                  const nodeType = String(childNode.type?.name || "");
                  if (
                    nodeType === "image" &&
                    baseChildNode.type?.name === "image"
                  ) {
                    decorateImageDiff(childNode, baseChildNode, childPos);
                    return;
                  }
                  if (
                    nodeType === "taskItem" &&
                    baseChildNode.type?.name === "taskItem"
                  ) {
                    decorateTaskItemDiff(childNode, baseChildNode, childPos);
                  }
                });
              };

              const walk = (snapshotParent, baseParent, snapshotParentPos) => {
                const snapshotChildren = [];
                const snapshotPositions = [];
                let offset = 0;
                for (
                  let index = 0;
                  index < snapshotParent.childCount;
                  index += 1
                ) {
                  const child = snapshotParent.child(index);
                  snapshotChildren.push(child);
                  snapshotPositions.push(snapshotParentPos + offset);
                  offset += child.nodeSize;
                }
                const baseChildren = [];
                for (let index = 0; index < baseParent.childCount; index += 1) {
                  baseChildren.push(baseParent.child(index));
                }
                const ops = diffNodeSequences(snapshotChildren, baseChildren);
                let snapshotCursor = snapshotParentPos;
                ops.forEach((op) => {
                  if (op.type === "add") {
                    const snapshotNode = snapshotChildren[op.snapshotIndex];
                    const nodePos = snapshotPositions[op.snapshotIndex];
                    decorateAddedSubtree(snapshotNode, nodePos);
                    snapshotCursor = nodePos + snapshotNode.nodeSize;
                    return;
                  }
                  if (op.type === "remove") {
                    const baseNode = baseChildren[op.baseIndex];
                    decorateRemovedNode(baseNode, snapshotCursor);
                    return;
                  }

                  const snapshotNode = snapshotChildren[op.snapshotIndex];
                  const baseNode = baseChildren[op.baseIndex];
                  const nodePos = snapshotPositions[op.snapshotIndex];
                  snapshotCursor = nodePos + snapshotNode.nodeSize;
                  if (!snapshotNode || !baseNode) {
                    return;
                  }

                  const nodeType = String(snapshotNode.type?.name || "");
                  if (nodeType === "image" && baseNode.type?.name === "image") {
                    decorateImageDiff(snapshotNode, baseNode, nodePos);
                    return;
                  }

                  if (
                    nodeType === "taskItem" &&
                    baseNode.type?.name === "taskItem"
                  ) {
                    decorateTaskItemDiff(snapshotNode, baseNode, nodePos);
                  }

                  if (snapshotNode.isTextblock && baseNode.isTextblock) {
                    decorateTextblockDiff(snapshotNode, baseNode, nodePos);
                    decorateLinkDiffsInTextblock(
                      snapshotNode,
                      baseNode,
                      nodePos,
                    );
                    compareNonTextChildrenInTextblock(
                      snapshotNode,
                      baseNode,
                      nodePos,
                    );
                    return;
                  }

                  const sameType =
                    snapshotNode.type?.name === baseNode.type?.name;
                  if (!sameType) {
                    decorations.push(
                      Decoration.node(
                        nodePos,
                        nodePos + snapshotNode.nodeSize,
                        {
                          class:
                            "mfe-snapshot-compare-block mfe-snapshot-compare-block--changed",
                        },
                      ),
                    );
                    return;
                  }

                  if (snapshotNode.childCount > 0 || baseNode.childCount > 0) {
                    walk(snapshotNode, baseNode, nodePos + 1);
                  }
                });
              };

              walk(state.doc, baseDoc, 0);

              return decorations.length
                ? DecorationSet.create(state.doc, decorations)
                : DecorationSet.empty;
            },
          },
        }),
      ];
    },
  });
}

export const UnderlineMark = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML() {
    return ["u", 0];
  },
});

export const SuperscriptMark = Mark.create({
  name: "superscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML() {
    return ["sup", 0];
  },
});

export const SubscriptMark = Mark.create({
  name: "subscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML() {
    return ["sub", 0];
  },
});

export function createMfeLinkExtension() {
  return Link.extend({
    addAttributes() {
      return {
        ...(this.parent?.() || {}),
        pageId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-pw-page"),
          renderHTML: (attributes) =>
            attributes.pageId ? { "data-pw-page": attributes.pageId } : {},
        },
        pageLang: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-pw-lang"),
          renderHTML: (attributes) =>
            attributes.pageLang ? { "data-pw-lang": attributes.pageLang } : {},
        },
      };
    },
  }).configure({
    openOnClick: false,
    linkOnPaste: true,
  });
}

export function createMfeImageExtension(resolveImageBaseUrl) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        src: {
          default: null,
          parseHTML: (element) => element.getAttribute("src"),
          renderHTML: (attributes) => {
            if (!attributes.src) return {};

            if (attributes.src.match(/^(https?:|\/|\?|\/\/)/)) {
              return { src: attributes.src };
            }

            const resolvedSrc = `${resolveImageBaseUrl()}${attributes.src.replace(/^\/+/, "")}`;
            return { src: resolvedSrc };
          },
        },
        originalFilename: {
          default: null,
        },
      };
    },
    addNodeView() {
      return ({ node, HTMLAttributes, getPos, decorations }) => {
        const resolveImageSrc = (src) => {
          if (!src) return "";
          if (src.match(/^(https?:|\/|\?|\/\/)/)) return src;
          return `${resolveImageBaseUrl()}${src.replace(/^\/+/, "")}`;
        };

        const applyImageDecorationClasses = (target, decorationSet = []) => {
          if (!target) return;
          target.className = "mfe-tiptap-image-container";
          const classNames = new Set();
          const htmlClassName = String(HTMLAttributes?.class || "").trim();
          if (htmlClassName) {
            htmlClassName.split(/\s+/).forEach((token) => {
              if (token) classNames.add(token);
            });
          }
          (Array.isArray(decorationSet) ? decorationSet : []).forEach(
            (decoration) => {
              const attrs = decoration?.type?.attrs || decoration?.attrs || {};
              const className = String(attrs?.class || "").trim();
              if (!className) return;
              className.split(/\s+/).forEach((token) => {
                if (token) classNames.add(token);
              });
            },
          );
          classNames.forEach((className) => target.classList.add(className));
        };

        const container = document.createElement("span");
        container.classList.add("mfe-tiptap-image-container");
        applyImageDecorationClasses(container, decorations);

        const img = document.createElement("img");

        Object.entries(HTMLAttributes).forEach(([key, value]) => {
          if (key === "class") return;
          if (value !== null && value !== undefined) {
            img.setAttribute(key, value);
          }
        });

        const label = document.createElement("span");
        label.classList.add("mfe-tiptap-image-label");
        label.innerText = "edit";

        container.append(img, label);

        container.ondblclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.mfeOpenImagePicker) {
            const imagePos = typeof getPos === "function" ? getPos() : null;
            window.mfeOpenImagePicker(node.attrs, imagePos);
          }
        };

        return {
          dom: container,
          update: (updatedNode, updatedDecorations) => {
            if (updatedNode.type.name !== "image") return false;
            applyImageDecorationClasses(container, updatedDecorations);
            const src = resolveImageSrc(updatedNode.attrs.src);
            if (src) {
              img.setAttribute("src", src);
            } else {
              img.removeAttribute("src");
            }
            img.setAttribute("alt", updatedNode.attrs.alt || "");
            if (updatedNode.attrs.title) {
              img.setAttribute("title", updatedNode.attrs.title);
            } else {
              img.removeAttribute("title");
            }
            return true;
          },
        };
      };
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleDoubleClickOn: (view, pos, node, nodePos, event, direct) => {
              if (node.type.name === "image") {
                if (window.mfeOpenImagePicker) {
                  window.mfeOpenImagePicker(node.attrs, nodePos);
                }
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  }).configure({
    inline: true,
    allowBase64: false,
  });
}
