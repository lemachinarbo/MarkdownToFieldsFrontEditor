import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";

export function createTransactionGuardExtension(options = {}) {
  const {
    name = "mfeTransactionGuard",
    shouldBlockTransaction = () => false,
    onBlockedTransaction = null,
  } = options;

  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey(`${name}Plugin`),
          filterTransaction: (transaction, state) => {
            if (!transaction?.docChanged) return true;
            const blocked = Boolean(shouldBlockTransaction(transaction, state));
            if (!blocked) return true;
            if (typeof onBlockedTransaction === "function") {
              onBlockedTransaction(transaction, state);
            }
            return false;
          },
        }),
      ];
    },
  });
}
