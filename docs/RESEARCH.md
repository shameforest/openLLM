# Recherche: Modelle, Agenten-Hülle, Modell-Server (Stand 14.10.2026)

## ⚠️ Wie verlässlich das hier ist — zuerst lesen
Die Recherche lief in zwei Cloud-Agenten mit Websuche. Wichtige Einschränkung:
- **Agenten-Hülle und Modell-Server: gut belegt.** Direkt aus den Quelltexten auf GitHub gelesen (Versionen, Lizenzen, Funktionen), mit Quellenliste.
- **Modellnamen und Benchmark-Zahlen: mit Vorsicht.** Hugging Face, Ollama und YouTube waren aus der Cloud **nicht direkt erreichbar**; der Agent hat über Such­zusammenfassungen gearbeitet. Die Namen liegen hinter dem Wissensstand des Hauptmodells (Januar 2026) und sind nicht aus erster Hand bestätigt. **Jeden Modellnamen und jede Lizenz am Download-Tag an der echten Quelle prüfen.**
- Kennzeichnung: `[geprüft: Quelle]` = an der Quelle gelesen; `[unsicher]` = nur aus Zusammenfassung/Gedächtnis.
- Benchmark-Vorsicht: Anbieterzahlen liegen oft ~15 Punkte über unabhängigen Tests; der bekannteste Test SWE-bench Verified gilt wegen „durchgesickerter“ Aufgaben als angeschlagen [geprüft: openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/].

---

## 1. Modelle (offene Programmier-Modelle für 24 GB, Turing)
Alle Kandidaten gibt es als *GGUF* (das 4-Bit-Format, das auf deiner Karte läuft). V = SWE-bench Verified, TB = Terminal-Bench, LCB = LiveCodeBench. „MoE/aktiv“ = großes Modell, rechnet pro Schritt nur mit einem kleinen Teil → schnell.

**Empfohlene Auswahl (4 Stück, alle Apache-2.0, passen in 24 GB):**

| Rolle | Modell | Größe 4-Bit | Werte (grob) | Vorsicht |
|---|---|---|---|---|
| Stark 1 | Qwen3.8-27B | ~17–20 GB | unabh. TB 58, LCB 84; Anbieter höher | überdenkt stark → „Denkstufe“ niedrig stellen |
| Stark 2 | Qwen3.6-27B | ~16 GB | V 77,2; TB 59,3; LCB 84 | Werkzeug-Aussetzer nach ~10 Schritten |
| Schnell 1 | Qwen3.6-35B-A3B (MoE) | ~22 GB (knapp) | V 73,4; TB 51,5 | wenig Speicher-Puffer neben dem Kontext |
| Schnell 2 | Devstral Small 2 (24B) | ~14 GB | V 68,0; TB 22,5 | schwach bei Terminal-Aufgaben, aber viel Platz für Kontext |

**Start:** nur **Qwen3.8-27B** (bestes Gesamtbild, passt). Die anderen drei und ein Blindtest folgen später. [geprüft: github.com/QwenLM/Qwen3.8; benchlm.ai/models/qwen3-8-27b — gelesen über Suchzusammenfassung, nicht die Seite selbst]

**Weitere, nicht gewählt:**
- Meta Muse Glimmer 30B (Apache-2.0, agenten-optimiert, <20 GB) — nur Anbieterzahlen [unsicher: venturebeat.com-Meldung]. Guter Blindtest-Kandidat.
- Ornith-1.5-35B-A3B (MIT), Anbieter V 79 / TB 67,8 — **nicht unabhängig bestätigt** [unsicher: benchlm.ai].
- GLM-4.7-Flash 30B-A3B (~17,5 GB, MIT wahrscheinlich); Granite 4.2-30B; Gemma 4; gpt-oss-20b [Gedächtnis/teilgeprüft].

**Passen NICHT / ausgeschlossen:** DeepSeek V4 (selbst 1-Bit ~92 GB), GLM-5.x, Kimi K3 (Billionen-Parameter). Lizenz-Ausschluss: Codestral (nicht für Produktion), CWM-32B (nur Forschung), Devstral 2 123B und Mistral Medium (Umsatz-Deckel/geänderte Lizenz). Qwen3-Coder-Next 80B-A3B bräuchte CPU-Auslagerung und hat eine fragliche Lizenzdatei.
- **Lizenz-Warnung Qwen:** Die 27B-Modelle sind Apache-2.0, aber andere Qwen-Varianten haben eine Zusatzlizenz, die kommerzielle Code-Assistenten einschränkt. Nur die sauber Apache-lizenzierte 27B-Variante nehmen und die LICENSE-Datei vor dem Download lesen. [geprüft: github.com/currentai-org/os-ai-map]

**Turing-Hinweis:** Auf einer verwandten Karte lief Qwen3.8-27B mit ~30–37 Token/s [geprüft: ai-muninn.com-Blog]; auf der RTX 6000 vermutlich 30–40 [unsicher]. Erste Anfrage nach dem Start langsam (einmalige Kern-Übersetzung) → in der Konfiguration abfangen. LLM und ComfyUI teilen sich die 24 GB, nicht gleichzeitig.

## 2. Agenten-Hülle — Vergleich und Entscheidung
Gelesen direkt aus den GitHub-Quelltexten (Stand 14.10.2026).

| Hülle | Sprache | Lizenz | lokal? | Besonderheit |
|---|---|---|---|---|
| **OpenCode** (anomalyco, früher sst) | TypeScript | MIT | ja | fast alle gewünschten Funktionen, CLI **und** Web-Oberfläche, liest `CLAUDE.md`/Skills |
| Qwen Code (Alibaba) | TypeScript | Apache-2.0 | ja | eingebaute Abschottung (Docker), Plan/Auto-Modus, 22 Hook-Ereignisse |
| Goose (Linux Foundation) | Rust | Apache-2.0 | ja | stabil, aber kein Plan-Modus, keine Hooks |
| Cline | TypeScript | Apache-2.0 | ja | Plan/Act, MCP; keine Web-Oberfläche |
| OpenHands | Python+TS | MIT | ja | Docker-Abschottung, Web-Oberfläche; Rest ungeprüft |
| Codex CLI (OpenAI) | Rust | Apache-2.0 | nur über /v1/responses | lokal eingeschränkt |
| Gemini CLI (Google) | TypeScript | Apache-2.0 | **nein** (nur Google-Login) | fällt raus |
| Aider | Python | Apache-2.0 | ja | seit Mai 2026 kaum noch gepflegt |

**Entscheidung: OpenCode erweitern** (Konfidenz 65). Selbst von einer Bibliothek aus bauen lohnt nicht (~85 % Mehraufwand ohne Mehrwert). Erweitern über Markdown-Agenten + ein Plugin + MCP-Server, ohne Fork. Lücken, die wir schließen: Browser-Test (Playwright als MCP), Abschottung (WSL/Docker), Modell-Rollen sind durch die 24 GB real begrenzt. **Rückfall Qwen Code**, falls ein 1-Stunden-Vergleich auf dem lokalen Modell es vorn sieht. [geprüft: github.com/anomalyco/opencode und dessen docs-Dateien; Umbenennung sst→anomalyco bestätigt]

## 3. Modell-Server — Vergleich und Entscheidung
Für Turing (sm_75, kein BF16/FP8).

| Server | Turing? | Besonderheit |
|---|---|---|
| **Ollama** | ja | kennst du aus OpenDali, OpenAI-kompatibel, automatischer Modellwechsel |
| llama.cpp (llama-server) | ja | 7B Q4 ~103 Token/s auf der RTX 6000 [geprüft: github.com/ggml-org/llama.cpp], mehr Feineinstellung |
| vLLM | nur teils | beste Parallelität, aber FP8-Kerne brauchen neuere Karten |
| LM Studio | ja (über llama.cpp) | geschlossene App |
| SGLang / TGI | nein / eingestellt | fallen raus |

**Entscheidung: Ollama** (Konfidenz 60). Gleiche Rechen-Grundlage wie llama.cpp, geringes Risiko. Einstellungen: `OLLAMA_CONTEXT_LENGTH` ≥ 64k (Programmier-Werkzeuge brauchen viel *Kontext* = gleichzeitig sichtbarer Text), `OLLAMA_KV_CACHE_TYPE=q8_0`, `NUM_PARALLEL=1` außer bei Parallel-Agenten. **Rückfall llama-server** bei Werkzeug-Fehlern oder >2 Agenten (eine Zeile in der OpenCode-Konfiguration). [geprüft: github.com/ollama/ollama und docs]

## 4. Vor dem ersten Download zu prüfen (echte Quelle öffnen)
1. Qwen3.8-27B: exakter Ollama-Name (Tag) und die **LICENSE-Datei** (Apache-2.0 bestätigen).
2. OpenCode: aktueller Installationsbefehl und die genauen Konfigurations-Felder für einen lokalen OpenAI-Endpunkt (Ollama).
3. Shadow-PC: erlaubt die Maschine WSL/Docker? (für die Abschottung in M3).

## Quellen (Auswahl)
GitHub: anomalyco/opencode, QwenLM/qwen-code, aaif-goose/goose, cline/cline, OpenHands/OpenHands, ollama/ollama, ggml-org/llama.cpp, vllm-project/vllm. Weiter: openai.com (SWE-bench-Hinweis), benchlm.ai, ai-muninn.com (Turing-Messung), venturebeat.com (Muse Glimmer). Vollständige Liste in den Agenten-Berichten dieser Sitzung.
