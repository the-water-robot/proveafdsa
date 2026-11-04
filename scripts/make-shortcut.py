#!/usr/bin/env python3
"""Genera il Comando rapido iOS "Carica su Prove AFdSA" (menu Condividi, es. dai Memo Vocali).

Uso:  python3 scripts/make-shortcut.py   → public/carica-prove-afdsa.shortcut (firmato)
Richiede macOS (`shortcuts sign`).

Passi del Comando:
  1. Ottieni nome dell'input condiviso
  2. POST {name} a /api/shortcut  → risposta testo = URL di caricamento (sessione Google)
  3. PUT del file su quell'URL (diretto a Google, nessun limite di dimensione)
  4. Notifica "Caricato ✓"
"""
import os, plistlib, subprocess, tempfile, uuid

BASE = os.environ.get("AFDSA_URL", "https://proveafdsa.vercel.app")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "carica-prove-afdsa.shortcut")

U_NAME, U_SESSION, U_PUT = (str(uuid.uuid4()).upper() for _ in range(3))
INPUT = {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}

def token(uid, output_name):
    return {
        "Value": {
            "string": "￼",
            "attachmentsByRange": {"{0, 1}": {"OutputName": output_name, "OutputUUID": uid, "Type": "ActionOutput"}},
        },
        "WFSerializationType": "WFTextTokenString",
    }

def text(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}

actions = [
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.getitemname",
        "WFWorkflowActionParameters": {"UUID": U_NAME, "WFInput": INPUT},
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": U_SESSION,
            "WFURL": f"{BASE}/api/shortcut",
            "WFHTTPMethod": "POST",
            "WFHTTPBodyType": "JSON",
            "ShowHeaders": False,
            "WFJSONValues": {
                "Value": {
                    "WFDictionaryFieldValueItems": [
                        {"WFItemType": 0, "WFKey": text("name"), "WFValue": token(U_NAME, "Name")},
                    ]
                },
                "WFSerializationType": "WFDictionaryFieldValue",
            },
        },
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
        "WFWorkflowActionParameters": {
            "UUID": U_PUT,
            "WFURL": token(U_SESSION, "Contents of URL"),
            "WFHTTPMethod": "PUT",
            "WFHTTPBodyType": "File",
            "ShowHeaders": False,
            "WFRequestVariable": INPUT,
        },
    },
    {
        "WFWorkflowActionIdentifier": "is.workflow.actions.notification",
        "WFWorkflowActionParameters": {
            "WFNotificationActionTitle": "Prove AFdSA",
            "WFNotificationActionBody": "Caricato su Drive ✓ 🤘",
            "WFNotificationActionSound": True,
        },
    },
]

shortcut = {
    "WFWorkflowClientVersion": "2302.0.4",
    "WFWorkflowMinimumClientVersion": 900,
    "WFWorkflowMinimumClientVersionString": "900",
    "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
    "WFWorkflowImportQuestions": [],
    "WFWorkflowTypes": ["ActionExtension"],  # compare nel menu Condividi
    "WFWorkflowInputContentItemClasses": ["WFAVAssetContentItem", "WFGenericFileContentItem"],
    "WFWorkflowOutputContentItemClasses": [],
    "WFWorkflowHasShortcutInputVariables": True,
    "WFWorkflowHasOutputFallback": False,
    "WFQuickActionSurfaces": [],
    "WFWorkflowActions": actions,
}

with tempfile.TemporaryDirectory() as d:
    raw = os.path.join(d, "Carica su Prove AFdSA.shortcut")
    with open(raw, "wb") as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)
    r = subprocess.run(["shortcuts", "sign", "--mode", "anyone", "--input", raw, "--output", os.path.abspath(OUT)],
                       capture_output=True, text=True)
    print(r.stdout, r.stderr)
    r.check_returncode()
print("scritto", os.path.abspath(OUT), os.path.getsize(OUT), "byte")
