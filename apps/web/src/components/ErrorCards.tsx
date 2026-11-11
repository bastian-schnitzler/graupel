// SPDX-FileCopyrightText: 2026 Bastian Schnitzler
// SPDX-License-Identifier: GPL-3.0-or-later
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.ts";
import { CloseIcon } from "../icons/index.ts";
import { NoticesContext, createNoticeStore, useNoticeHost, useNoticeList, type NoticeStore } from "../state/notices.ts";
import "./ErrorCards.css";

/**
 * Error messages as cards in the bottom-left corner (REQ-492), stacked, newest at the bottom, each with a close
 * button. While a modal dialog is open the cards render inside it, since the page behind it is inert.
 */
export function ErrorCards({ store }: { store: NoticeStore }) {
  const t = useT();
  const notices = useNoticeList(store);
  const host = useNoticeHost(store);
  if (notices.length === 0) return null;
  const closeLabel = t("notice.close");
  const region = (
    <div className="error-cards" role="region" aria-label={t("notice.region")} data-testid="error-cards">
      {notices.map((notice) => (
        <div key={notice.id} className="error-card" role="alert" data-testid="error-card" data-notice={notice.id}>
          <div className="error-card__body">
            <p className="error-card__text">{t(notice.message, notice.params)}</p>
            {notice.detail && (
              <p className="error-card__detail" data-testid="error-card-detail">
                {t(notice.detail, notice.params)}
              </p>
            )}
          </div>
          <button
            type="button"
            className="error-card__close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={() => store.dismiss(notice.id)}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
  return host ? createPortal(region, host) : region;
}

/** Notice store of the page with the region of its cards (inside `I18nProvider`). */
export function NoticesProvider({ children, store }: { children?: ReactNode; store?: NoticeStore }) {
  const [own] = useState(createNoticeStore);
  const value = store ?? own;
  return (
    <NoticesContext.Provider value={value}>
      {children}
      <ErrorCards store={value} />
    </NoticesContext.Provider>
  );
}
