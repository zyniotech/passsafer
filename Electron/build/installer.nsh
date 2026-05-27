!macro customInstall
  ; Registry-Einträge für Google Chrome, Brave und Microsoft Edge erstellen
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\de.passsafer.helper" "" "$INSTDIR\resources\native-host\de.passsafer.helper.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\de.passsafer.helper" "" "$INSTDIR\resources\native-host\de.passsafer.helper.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\de.passsafer.helper" "" "$INSTDIR\resources\native-host\de.passsafer.helper.json"
!macroend

!macro customUnInstall
  ; Registry-Einträge bei Deinstallation sauber entfernen
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\de.passsafer.helper"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\de.passsafer.helper"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\de.passsafer.helper"
!macroend
