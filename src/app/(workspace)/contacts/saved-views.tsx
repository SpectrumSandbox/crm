"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Star, Trash2 } from "lucide-react";
import { useCrm, useUi } from "@/lib/store";
import type { SavedView } from "@/lib/seed-ext/accounts";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Modal } from "@/components/ui/overlays";

/**
 * Saved list views for /contacts, /companies and /tickets: the page's URL query stored under a name, private or
 * shared with the workspace (persisted and synced). `query` is the page's current query string without "?".
 */
export function SavedViewsMenu({ object, basePath, query }: { object: SavedView["object"]; basePath: string; query: string }) {
  const router = useRouter();
  const savedViews = useCrm((s) => s.savedViews);
  const currentUserId = useCrm((s) => s.currentUserId);
  const users = useCrm((s) => s.users);
  const saveView = useCrm((s) => s.saveView);
  const deleteView = useCrm((s) => s.deleteView);
  const restoreView = useCrm((s) => s.restoreView);
  const notify = useUi((s) => s.notify);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);

  const views = useMemo(() => savedViews.filter((v) => v.object === object && (v.shared || v.ownerId === currentUserId)).sort((a, b) => a.name.localeCompare(b.name)), [savedViews, object, currentUserId]);
  const active = views.find((v) => normalise(v.query) === normalise(query));

  const submit = () => {
    if (!name.trim()) return;
    saveView({ object, name: name.trim(), query, shared });
    notify(`Saved view “${name.trim()}”`);
    setSaving(false);
    setName("");
    setShared(false);
  };

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Saved views">
            <Star /> {active ? active.name : "Saved views"}
            {views.length ? <span className="rounded-sm bg-sg-card-3 px-1 text-[10px] text-sg-muted">{views.length}</span> : null}
          </Button>
        </MenuTrigger>
        <MenuContent className="w-72">
          <MenuLabel>Saved views</MenuLabel>
          {views.length ? (
            views.map((v) => (
              <div key={v.id} className="group flex items-center">
                <MenuItem active={v.id === active?.id} className="flex-1" onSelect={() => router.replace(v.query ? `${basePath}?${v.query}` : basePath)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{v.name}</span>
                    <span className="truncate text-2xs text-sg-dim">
                      {v.shared ? "Shared" : "Only you"} · {users.find((u) => u.id === v.ownerId)?.name ?? "—"}
                    </span>
                  </span>
                </MenuItem>
                {v.ownerId === currentUserId && (
                  <button
                    type="button"
                    aria-label={`Delete saved view ${v.name}`}
                    onClick={() => {
                      const removed = deleteView(v.id);
                      if (removed) notify(`Deleted view “${removed.name}”`, { label: "Undo", run: () => restoreView(removed) });
                    }}
                    className="mr-1 rounded p-1 text-sg-dim opacity-0 hover:bg-sg-card-3 hover:text-soft-red focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-sg-dim">No saved views yet. Filter the list, then save it here.</p>
          )}
          <MenuSeparator />
          <MenuItem onSelect={() => setSaving(true)}>Save current view…</MenuItem>
        </MenuContent>
      </Menu>

      <Modal
        open={saving}
        onOpenChange={setSaving}
        title="Save this view"
        description="Stores the current list, filters and search under a name."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSaving(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} onClick={submit}>
              Save view
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="e.g. My hot leads in Energy"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-sg-text">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-3.5 accent-white" />
            Share with the whole workspace
          </label>
          <p className="break-all rounded border border-sg-line bg-sg-bg/60 px-2 py-1.5 font-mono text-2xs text-sg-dim">{query ? `${basePath}?${query}` : basePath}</p>
        </div>
      </Modal>
    </>
  );
}

function normalise(q: string) {
  const p = new URLSearchParams(q);
  p.sort();
  return p.toString();
}
