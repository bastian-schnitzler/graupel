// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useRef, useState, type FormEvent } from "react";
import { Dialog } from "../../dialogs/Dialog.tsx";
import { useT } from "../../i18n/index.ts";
import "./RenameFavoriteDialog.css";

export interface RenameFavoriteDialogProps {
  /** Name the favourite is shown by in the menu, asked about in the heading. */
  label: string;
  /** Text the field starts with: the favourite's own name, empty for a point without one (REQ-536). */
  initial: string;
  /** OK or Enter with a name that is not empty; the name comes trimmed. */
  onConfirm: (name: string) => void;
  /** Cancel, Escape, the X or a press beside the popup. */
  onCancel: () => void;
}

/**
 * Popup for renaming a favourite on a phone or a tablet (REQ-862), in the look of the other dialogs (REQ-776: the X
 * without a blue frame): the question "<name> rename?", a field with the name so far, focused and selected, and the
 * buttons "OK" and "Cancel". OK and Enter take a name that is not empty; an empty one leaves OK disabled and the popup
 * open. Cancel, Escape and the X close it without a change.
 */
export function RenameFavoriteDialog({ label, initial, onConfirm, onCancel }: RenameFavoriteDialogProps) {
  const t = useT();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  // Marked as invalid only once something was typed: a point without own name starts empty (REQ-536).
  const [typed, setTyped] = useState(false);
  const empty = draft.trim() === "";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!empty) onConfirm(draft.trim());
  };

  return (
    <Dialog
      title={t("location.favorites.renameQuestion", { name: label })}
      onClose={onCancel}
      initialFocus={fieldRef}
      className="rename-dialog"
      testId="rename-favorite-dialog"
    >
      <form className="rename-dialog__form" onSubmit={submit}>
        <input
          ref={fieldRef}
          className="rename-dialog__field"
          type="text"
          spellCheck={false}
          autoComplete="off"
          maxLength={80}
          aria-label={t("location.favorites.nameLabel")}
          aria-invalid={(typed && empty) || undefined}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setTyped(true);
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
        <div className="rename-dialog__actions">
          <button type="button" className="rename-dialog__button" onClick={onCancel}>
            {t("location.favorites.renameCancel")}
          </button>
          <button type="submit" className="rename-dialog__button rename-dialog__button--ok" disabled={empty}>
            {t("location.favorites.renameOk")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
