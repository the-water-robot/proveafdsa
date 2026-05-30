// Utility lato CLIENT per l'upload in due passi:
//  1) chiede al nostro server l'URL di sessione resumable;
//  2) fa il PUT dei byte direttamente a Google (con barra di progresso via XHR).

export interface UploadSession {
  sessionUrl: string;
  folderId: string;
  folderName: string;
  folderWebViewLink: string;
}

export async function requestUploadSession(params: {
  rehearsalDate: string;
  fileName: string;
  mimeType: string;
  pin?: string;
}): Promise<UploadSession> {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let msg = `Errore ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* corpo non JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

/** PUT del file sull'URL di sessione. `onProgress` riceve un valore 0..1. */
export function putResumable(
  sessionUrl: string,
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload fallito (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Errore di rete durante l'upload"));
    xhr.send(file);
  });
}

/** Flusso completo per un singolo file. */
export async function uploadOne(
  params: { rehearsalDate: string; fileName: string; file: Blob; pin?: string },
  onProgress?: (fraction: number) => void,
): Promise<UploadSession> {
  const session = await requestUploadSession({
    rehearsalDate: params.rehearsalDate,
    fileName: params.fileName,
    mimeType: params.file.type || "application/octet-stream",
    pin: params.pin,
  });
  await putResumable(session.sessionUrl, params.file, onProgress);
  return session;
}
