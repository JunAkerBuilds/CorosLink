; Windows Firewall: lets phones on the same Wi-Fi reach C-LINK's phone server (desktop/main/phones/firewall.ts uses
; the same rule name). Private and domain networks only. netsh needs admin, so this only takes for an install "for
; anyone"; a per-user install gets the rule from Remote access → Allow, behind a UAC prompt.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name=C-LINK-phones'
  nsExec::Exec 'netsh advfirewall firewall add rule name=C-LINK-phones dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" protocol=TCP profile=private,domain enable=yes'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name=C-LINK-phones'
!macroend
