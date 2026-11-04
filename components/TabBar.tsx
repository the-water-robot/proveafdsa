"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe } from "@/lib/queue";

export default function TabBar() {
  const path = usePathname();
  const { recording, uploading, items } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pending = items.filter((i) => i.status !== "done").length;
  const tabs = [
    { href: "/", label: "Carica", active: path === "/", Icon: UploadIcon },
    { href: "/prove", label: "Prove", active: path.startsWith("/prove"), Icon: MusicIcon },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 border-t border-dark-border bg-dark-bg/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex h-14 max-w-md">
        {tabs.map(({ href, label, active, Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={(e) => {
              if (
                !active &&
                recording &&
                !window.confirm("Stai registrando: se cambi pagina la registrazione si ferma (resta in coda). Continuare?")
              ) {
                e.preventDefault();
              }
            }}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
              active ? "text-flamingo" : "text-sand/50 hover:text-sand/80"
            }`}
          >
            <span className="relative">
              <Icon />
              {href === "/" && (recording || uploading || pending > 0) && (
                <span
                  className={`absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-dark-bg ${
                    recording ? "animate-pulse bg-coral" : uploading ? "animate-pulse bg-sky" : "bg-solar"
                  }`}
                  aria-label={recording ? "Registrazione in corso" : uploading ? "Caricamento in corso" : "File da caricare"}
                />
              )}
            </span>
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
