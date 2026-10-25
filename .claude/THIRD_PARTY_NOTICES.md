# Provenance des agents dans .claude/agents/

Les 18 fichiers d'agent du dossier `.claude/agents/` sont repris, tels
quels, du dépôt open source **oh-my-claudecode** :
https://github.com/Yeachan-Heo/oh-my-claudecode

Un seul agent de ce dépôt (`qa-tester.md`, testeur CLI interactif via tmux)
n'a volontairement pas été repris : il dépend de tmux et d'un usage en
ligne de commande interactive, peu pertinent pour cette application web.
Tout le reste de ce dépôt (le CLI `omc`, les modes d'orchestration Team/
Autopilot/Execute/Ralph/Verify, les skills, le HUD, les intégrations de
notification) n'a pas été intégré — seuls ces 18 agents, directement
utiles pour coder, l'ont été.

## Licence

```
MIT License

Copyright (c) 2025 Yeachan Heo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
