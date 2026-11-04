import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — Prove AFdSA",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 pb-32 text-sm leading-relaxed text-slate-200">
      <h1 className="mb-6 text-2xl font-semibold text-white">Informativa sulla privacy</h1>
      <p className="mb-4">
        <strong>Prove AFdSA</strong> è un&apos;app privata usata dalla band &quot;Animali Fantastici
        del Sud America&quot; per caricare e riascoltare le registrazioni delle prove.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold text-white">Dati trattati</h2>
      <p className="mb-4">
        L&apos;app carica i file audio/video scelti dall&apos;utente in una cartella Google Drive di
        proprietà della band. Non raccoglie account, nomi, email o altri dati personali di chi
        carica, non usa cookie di profilazione e non condivide dati con terze parti.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold text-white">Uso dei dati Google</h2>
      <p className="mb-4">
        L&apos;accesso a Google Drive (API Google Drive) è usato esclusivamente per creare
        cartelle, caricare, elencare e riprodurre le registrazioni nella cartella della band.
        L&apos;uso delle informazioni ricevute dalle API Google rispetta la{" "}
        <a
          className="underline"
          href="https://developers.google.com/terms/api-services-user-data-policy"
        >
          Google API Services User Data Policy
        </a>
        , inclusi i requisiti di Limited Use.
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold text-white">Conservazione e cancellazione</h2>
      <p className="mb-4">
        I file restano nella cartella Google Drive finché non vengono eliminati dal proprietario.
        L&apos;autorizzazione può essere revocata in qualsiasi momento da{" "}
        <a className="underline" href="https://myaccount.google.com/permissions">
          myaccount.google.com/permissions
        </a>
        .
      </p>

      <h2 className="mb-2 mt-6 text-lg font-semibold text-white">Contatti</h2>
      <p>
        Per domande: <a className="underline" href="mailto:maildipietroilacqua@gmail.com">maildipietroilacqua@gmail.com</a>
      </p>
    </main>
  );
}
