# Verbesserer — Cloud-Notiz (nächster lokaler Lauf übernimmt und löscht diese Datei)

## Lauf 2026-10-16 · OpenDante · LLM-Werkzeug · schnell · Cloud (ohne GPU-Messung)
Fokus: Modell lädt beim Fortsetzen eines Chats ungewöhnlich lange in die Grafikkarte.

IDs provisorisch — gegen echtes Profil (nächste freie OD-ID) abgleichen.

- **OD-A · Modell beim Öffnen/Fortsetzen eines Chats vorladen.** GELESEN web/src/App.tsx:249 — `keepWarm()` wird nur NACH einer Antwort aufgerufen; beim Reopen (App.tsx:118–130) nicht. Folge: Der ~18-GB-Ladevorgang blockiert die erste Antwort, statt beim Lesen/Tippen zu überlappen. Fix: beim Chat-Öffnen/Resume und beim App-Start `keepWarm(localModel, keepWarmMin)` aufrufen (lädt das Modell vorab). Wirkung 4, Aufwand S, Konfidenz 70. Kippt, wenn Messung zeigt, dass das Modell ohnehin warm war.
- **OD-B · 64k-Kontext + q8_0-KV-Cache könnten 24 GB sprengen → CPU-Auslagerung → lahm.** GELESEN config/opencode.json limit.context 65536; install.ps1 OLLAMA_KV_CACHE_TYPE q8_0. ANGENOMMEN: 27B-Q4 (~18 GB) + KV-Cache für 64k könnten >24 GB → Ollama lagert Schichten in den RAM aus, Laden UND Generieren werden deutlich langsamer. Das ist der stärkste Verdacht für „ungewöhnlich lange". Wirkung 5 (falls wahr), Aufwand S (OLLAMA_CONTEXT_LENGTH z. B. 32768), Konfidenz 50. MESSEN: `ollama ps` beim Laden zeigt CPU/GPU-Anteil; zu 100 % GPU = kein Offload.
- **OD-C · Warmhalte-Fenster beim Resume.** GELESEN settings keepWarmMin 60. Resume nach Ablauf (PC-Leerlauf > Fenster, oder Ollama-Neustart) = Kaltladen. Erwägen: OLLAMA_KEEP_ALIVE global setzen oder Default erhöhen. Wirkung 3, Aufwand S, Konfidenz 60.

Nächstes Mal: zuerst `ollama ps` + `nvidia-smi` beim Laden messen, um OD-B zu bestätigen/verwerfen.
