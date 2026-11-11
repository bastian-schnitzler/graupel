// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { Dialog } from "../../dialogs/Dialog.tsx";
import { useT } from "../../i18n/index.ts";
import { useHistory } from "../../state/index.ts";
import { HistoryList } from "./HistoryList.tsx";

export interface HistoryDialogProps {
  onClose: () => void;
}

/**
 * The phone's history (REQ-684): the menu entry "History" opens this dialog with the same choice as the desktop's
 * clock menu (`HistoryList`). A choice shows that fetch, or the current values again, and closes it.
 */
export function HistoryDialog({ onClose }: HistoryDialogProps) {
  const t = useT();
  const history = useHistory();
  return (
    <Dialog title={t("history.title")} onClose={onClose} className="history-dialog">
      <HistoryList
        fetches={history.fetches}
        shown={history.shown}
        currentFetchedAt={history.currentFetchedAt}
        currentLive={history.currentLive}
        onCurrent={() => {
          onClose();
          history.showCurrent();
        }}
        onShow={(fetch) => {
          onClose();
          void history.show(fetch.id);
        }}
      />
    </Dialog>
  );
}
