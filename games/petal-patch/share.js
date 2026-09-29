// Petal Patch share.js: navigator.share -> clipboard.writeText -> a pre-selected text field. Text is
// always inserted via textContent, never innerHTML (share lines are plain, no markup).

let fallbackField = null;

function ensureField() {
  if (fallbackField) return fallbackField;
  fallbackField = document.createElement("textarea");
  fallbackField.className = "pp-share-fallback";
  fallbackField.setAttribute("readonly", "");
  fallbackField.style.position = "fixed";
  fallbackField.style.left = "-9999px";
  document.body.appendChild(fallbackField);
  return fallbackField;
}

export async function shareResult(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch {
      // user cancelled or share failed -- fall through to clipboard
    }
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      if (window.UIKit && window.UIKit.toast) window.UIKit.toast("Copied to clipboard");
      return "clipboard";
    } catch {
      // clipboard blocked -- fall through to the visible field
    }
  }
  const field = ensureField();
  field.value = "";
  field.textContent = text;
  field.value = text;
  field.style.position = "fixed";
  field.style.left = "50%";
  field.style.top = "50%";
  field.style.transform = "translate(-50%,-50%)";
  field.style.zIndex = "50";
  field.focus();
  field.select();
  return "field";
}
