# Prove — Gli Animali Fantastici del Sud America

App mobile (PWA) per caricare **al volo le registrazioni delle prove** della band su una cartella
Google Drive condivisa. Chi suona apre il link, registra o sceglie un file, preme *Carica* → fatto.
**Nessun login per chi carica.**

- Ogni prova finisce in una sua sottocartella nominata con la data (es. `2026 05 30`).
- Registrazione direttamente nel browser **oppure** caricamento di file già pronti.
- Su Android: si può anche *condividere* un file da un'altra app verso "Prove AFdSA".

## Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router) |
| Linguaggio | TypeScript + Tailwind CSS |
| Drive | OAuth2 (`google-auth-library`) + REST, upload **resumable diretto** a Google |
| Deploy | Vercel |

## Come funziona (in breve)

1. Il browser chiede al server (`/api/upload-url`) un *URL di sessione* di upload.
2. Il server, usando il **refresh token del proprietario** del Drive, crea/trova la cartella della
   data e apre una sessione resumable, restituendo l'URL al browser.
3. Il browser carica i byte **direttamente su Google** (così si aggira il limite di 4.5 MB delle
   funzioni Vercel e si possono caricare anche file grandi). L'access token non lascia mai il server.

## Setup (una volta sola)

### 1. Credenziali Google
1. Vai su [console.cloud.google.com](https://console.cloud.google.com) **loggato con l'account che possiede la cartella Drive** (quello `u/1`).
2. Crea un progetto → **API e servizi → Abilita API → "Google Drive API"**.
3. **Credenziali → Crea credenziali → ID client OAuth → Tipo: "App desktop"**. Segna *Client ID* e *Client secret*.
4. **Schermata di consenso OAuth**: modalità *Testing*, aggiungi il tuo indirizzo come *Utente di test*.

### 2. Genera il refresh token
```bash
cp .env.local.example .env.local       # poi incolla CLIENT_ID e CLIENT_SECRET
npm install
npm run get-token                      # accedi col tuo account → copia il token stampato
```
Incolla il valore in `.env.local` alla voce `GOOGLE_REFRESH_TOKEN`.

### 3. Repo su GitHub
Crea un repo **vuoto** `the-water-robot/prove-afdsa`, poi dalla cartella del progetto:
```bash
git init && git add -A && git commit -m "Prove AFdSA"
git branch -M main
git remote add origin git@github.com:the-water-robot/prove-afdsa.git
git push -u origin main
```

### 4. Deploy su Vercel
1. [vercel.com/new](https://vercel.com/new) → importa `the-water-robot/prove-afdsa` (autodetect Next.js).
2. **Environment Variables** → aggiungi:

   | Nome | Valore |
   |---|---|
   | `GOOGLE_CLIENT_ID` | … |
   | `GOOGLE_CLIENT_SECRET` | … |
   | `GOOGLE_REFRESH_TOKEN` | … (dallo step 2) |
   | `DRIVE_FOLDER_ID` | `1jsOe6y1KC8ekYVceRPrHC2RLNyf5Hqxa` |
   | `UPLOAD_PIN` | *(lascia vuoto = link aperto)* |

3. **Deploy**. Verifica aprendo `https://<tuo-progetto>.vercel.app/api/health` → deve dire `"ok": true`.

## Sviluppo locale
```bash
npm install
npm run dev        # http://localhost:3000
```
Per testare l'upload in locale serve `.env.local` completo (con il refresh token).

## Uso per la band
1. Apri il link sul telefono → **"Aggiungi alla schermata Home"** (così sembra un'app).
2. Controlla la **data della prova** (di default è oggi).
3. 🔴 **Registra** lì per lì, oppure 📎 **Scegli file** per caricare audio già fatti.
4. (Opzionale) scrivi *chi sei* e un'*etichetta* → finiscono nel nome del file.
5. **Carica su Drive**. Compare il link alla cartella della prova.

## Note
- **Accesso aperto**: chiunque abbia il link può caricare. Per chiudere in futuro, imposta `UPLOAD_PIN`
  su Vercel (l'app chiederà quel codice, ricordato poi sul telefono). Nessun'altra modifica al codice.
- **iOS**: la registrazione in-app funziona su Safari recente. La *condivisione* da altre app verso la
  PWA è una funzione solo Android — su iPhone usa "Scegli file".
- **CORS**: l'upload sfrutta l'endpoint resumable di Google (supporta il `PUT` cross-origin dal browser).
  Da confermare al primo upload reale; in caso di problemi vedi i log della funzione `/api/upload-url`.
- **Scope token**: si usa lo scope `drive` (pieno) sull'account della band per affidabilità nel
  creare le sottocartelle. Il token vive solo nelle env di Vercel, mai esposto ai client. Per revocarlo:
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
