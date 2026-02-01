(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof exports === "object") {
    module.exports = factory();
  } else {
    root.tiptap = factory();
  }
})(this, function () {
  // Simple TipTap shim: provides Editor and StarterKit with a minimal API
  // This is a lightweight fallback for development environments where CDN
  // TipTap bundles are blocked. It uses contentEditable under the hood.

  function SimpleEditor(opts) {
    if (!opts || !opts.element) throw new Error("Missing element");
    this._host = opts.element;
    this._content = opts.content || "";
    // create internal editable container
    this._editable = document.createElement("div");
    this._editable.className = "tiptap-shim-editable";
    this._editable.setAttribute("contenteditable", "true");
    this._editable.innerHTML = this._content;
    this._host.appendChild(this._editable);
  }

  SimpleEditor.prototype.getHTML = function () {
    return this._editable ? this._editable.innerHTML : "";
  };

  SimpleEditor.prototype.destroy = function () {
    if (this._editable && this._editable.parentNode) {
      this._editable.parentNode.removeChild(this._editable);
    }
    this._editable = null;
    this._host = null;
  };

  // Expose a minimal StarterKit placeholder (not used by the shim)
  var StarterKit = {};

  return {
    Editor: SimpleEditor,
    StarterKit: StarterKit,
  };
});
