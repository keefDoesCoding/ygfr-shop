// Admin: photo upload (resized in the browser), photo ordering, size rows, dialogs.

const MAX_SIDE = 1600;
const TARGET_BYTES = 600 * 1024;

async function toWebp(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Fallback for formats createImageBitmap can't read directly.
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("unreadable"));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = bitmap.width;
  const h0 = bitmap.height;
  let scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  let quality = 0.84;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w0 * scale);
    canvas.height = Math.round(h0 * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", quality));
    const out = blob && blob.type === "image/webp" ? blob : await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (out.size <= TARGET_BYTES || attempt === 5) return out;
    quality -= 0.1;
    scale *= 0.85;
  }
}

const form = document.querySelector("[data-product-form]");
if (form) {
  const input = form.querySelector("[data-images-input]");
  const list = form.querySelector("[data-images-list]");
  const fileInput = form.querySelector("[data-file-input]");
  const dropzone = form.querySelector("[data-dropzone]");
  const status = form.querySelector("[data-upload-status]");
  const saveBtn = form.querySelector("[data-save]");
  let pending = 0;
  let dirty = false;

  const sync = () => {
    input.value = [...list.querySelectorAll("[data-ref]")].map((li) => li.dataset.ref).filter(Boolean).join(",");
  };
  const toolsHtml = list.querySelector(".uploader__tools")?.outerHTML;

  function itemEl(ref, src) {
    const li = document.createElement("li");
    li.className = "uploader__item";
    if (ref) li.dataset.ref = ref;
    li.innerHTML = `<img alt="" width="140" height="140">${toolsHtml || ""}`;
    li.querySelector("img").src = src;
    if (!toolsHtml) {
      const tools = document.createElement("div");
      tools.className = "uploader__tools";
      tools.innerHTML = `<button type="button" class="link-btn small" data-move="-1" aria-label="Move photo earlier">Left</button><button type="button" class="link-btn small" data-move="1" aria-label="Move photo later">Right</button><button type="button" class="link-btn small" data-remove-image aria-label="Remove photo">Remove</button>`;
      li.append(tools);
    }
    return li;
  }

  async function upload(files) {
    const room = 8 - list.children.length;
    const chosen = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).slice(0, Math.max(0, room));
    if (!chosen.length) {
      status.textContent = room <= 0 ? "You can add up to 8 photos." : "Those files aren't images.";
      return;
    }
    pending += chosen.length;
    saveBtn.disabled = true;
    status.textContent = `Uploading ${chosen.length} ${chosen.length === 1 ? "photo" : "photos"}…`;
    await Promise.all(
      chosen.map(async (file) => {
        const preview = URL.createObjectURL(file);
        const li = itemEl("", preview);
        li.classList.add("uploader__item--loading");
        list.append(li);
        try {
          const blob = await toWebp(file);
          const res = await fetch("/api/admin/images", { method: "POST", headers: { "content-type": blob.type }, body: blob });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Upload failed");
          li.dataset.ref = data.id;
          li.classList.remove("uploader__item--loading");
          dirty = true;
        } catch (err) {
          li.remove();
          status.textContent = `${file.name}: ${err.message === "unreadable" ? "your browser can't read this photo. Try saving it as JPG first." : err.message}`;
        } finally {
          pending--;
        }
      })
    );
    sync();
    if (!pending) {
      saveBtn.disabled = false;
      if (!status.textContent.includes(":")) status.textContent = "Photos added. Save to keep them.";
    }
  }

  fileInput.addEventListener("change", () => {
    upload(fileInput.files);
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((t) =>
    dropzone.addEventListener(t, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((t) => dropzone.addEventListener(t, () => dropzone.classList.remove("is-over")));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    upload(e.dataTransfer.files);
  });

  list.addEventListener("click", (e) => {
    const li = e.target.closest(".uploader__item");
    if (!li) return;
    if (e.target.closest("[data-remove-image]")) li.remove();
    const mv = e.target.closest("[data-move]");
    if (mv) {
      if (mv.dataset.move === "-1" && li.previousElementSibling) li.previousElementSibling.before(li);
      if (mv.dataset.move === "1" && li.nextElementSibling) li.nextElementSibling.after(li);
      mv.focus();
    }
    dirty = true;
    sync();
  });

  // Size rows
  const rows = form.querySelector("[data-size-rows]");
  const tpl = document.getElementById("tpl-size-row");
  const addRow = (label = "", stock = 1) => {
    const frag = tpl.content.cloneNode(true);
    frag.querySelector('[name="sizeLabel[]"]').value = label;
    frag.querySelector('[name="sizeStock[]"]').value = stock;
    rows.append(frag);
  };
  form.querySelector("[data-add-size]").addEventListener("click", () => {
    addRow();
    rows.lastElementChild.querySelector("input").focus();
    dirty = true;
  });
  form.querySelectorAll("[data-preset]").forEach((b) =>
    b.addEventListener("click", () => {
      rows.replaceChildren();
      b.dataset.preset.split(",").forEach((s) => addRow(s, 1));
      dirty = true;
    })
  );
  rows.addEventListener("click", (e) => {
    if (e.target.closest("[data-remove-size]")) {
      if (rows.children.length > 1) e.target.closest(".size-row").remove();
      dirty = true;
    }
  });

  form.addEventListener("input", () => (dirty = true));
  form.addEventListener("submit", (e) => {
    if (pending) {
      e.preventDefault();
      status.textContent = "Wait for photos to finish uploading.";
      return;
    }
    sync();
    dirty = false;
    saveBtn.setAttribute("aria-busy", "true");
    saveBtn.textContent = "Saving…";
  });
  document.getElementById("delete-dialog")?.addEventListener("submit", () => (dirty = false));
  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });
}

// Dialogs (delete confirmation)
document.addEventListener("click", (e) => {
  const opener = e.target.closest("[data-open-dialog]");
  if (opener) document.getElementById(opener.dataset.openDialog)?.showModal();
  const closer = e.target.closest("[data-close-dialog]");
  if (closer) closer.closest("dialog")?.close();
});
