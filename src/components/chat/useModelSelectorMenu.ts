import { useCallback, useEffect, useRef, useState } from "react";
import { getCatalogModel } from "../../lib/models/catalog";
import {
  type ModelDetailFocus,
  resolveDefaultDetailFocus,
} from "../../lib/models/model-selector-menu";

export function useModelSelectorMenu(selectionId: string) {
  const [open, setOpen] = useState(false);
  const [detailFocus, setDetailFocus] = useState<ModelDetailFocus>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const syncDefaultFocus = useCallback(() => {
    setDetailFocus(resolveDefaultDetailFocus(selectionId));
  }, [selectionId]);

  const openMenu = useCallback(() => {
    syncDefaultFocus();
    setOpen(true);
  }, [syncDefaultFocus]);

  const closeMenu = useCallback(() => {
    setDetailFocus(null);
    setOpen(false);
  }, []);

  const toggleMenu = useCallback(() => {
    setOpen((was) => {
      if (was) {
        setDetailFocus(null);
        return false;
      }
      syncDefaultFocus();
      return true;
    });
  }, [syncDefaultFocus]);

  const focusAutoDetail = useCallback(() => {
    setDetailFocus("auto");
  }, []);

  const onListPointerOver = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-model-id]");
    if (!row) return;
    const id = row.dataset.modelId;
    if (!id) return;
    if (id === "auto") {
      setDetailFocus("auto");
      return;
    }
    const model = getCatalogModel(id);
    if (model) setDetailFocus(model);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, open]);

  return {
    open,
    openMenu,
    closeMenu,
    toggleMenu,
    detailFocus,
    focusAutoDetail,
    onListPointerOver,
    rootRef,
  };
}
