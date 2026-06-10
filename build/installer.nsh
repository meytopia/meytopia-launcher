; ============================================================
; Meytopia Launcher — Désinstallation sans trace (CDC + demande)
; Exécuté par le désinstalleur NSIS (Windows "Applications" ou
; bouton du launcher) : supprime aussi les données du jeu.
; ============================================================
!macro customUnInstall
  RMDir /r "$APPDATA\.meytopia"
!macroend
