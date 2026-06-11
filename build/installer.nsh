; ============================================================
; Meytopia Launcher — Désinstallation sans trace (CDC + demande)
; Exécuté par le désinstalleur NSIS. La suppression des données
; ne s'applique QU'À une vraie désinstallation : pendant une
; mise à jour (drapeau --updated), tout est préservé — réglages,
; comptes, modpack.
; ============================================================
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\.meytopia"
  ${endIf}
!macroend
