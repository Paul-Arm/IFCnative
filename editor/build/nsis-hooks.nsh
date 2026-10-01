; Per-user Explorer integration for IFC files. The Tauri installer runs with
; RequestExecutionLevel user; all keys therefore live below HKCU and require
; no administrator privileges.
!macro NSIS_HOOK_POSTINSTALL
  ; Quote both executable and file path for user profiles containing spaces.
  WriteRegStr HKCU "Software\Classes\IFC-Modell\shell\open" "" "Mit IFCnative öffnen"
  WriteRegStr HKCU "Software\Classes\IFC-Modell\shell\open\command" "" "$\"$INSTDIR\ifcnative.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.ifc\shell\IFCnative" "MUIVerb" "Mit IFCnative öffnen"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.ifc\shell\IFCnative" "Icon" "$\"$INSTDIR\ifcnative.exe$\",0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.ifc\shell\IFCnative" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.ifc\shell\IFCnative\command" "" "$\"$INSTDIR\ifcnative.exe$\" $\"%1$\""
  ; Editor-Links "ifcnative://open?..." aus dem IFC Hub (Im Editor oeffnen).
  ; Der Link kommt als ein quotiertes Argument an (src-tauri/src/lib.rs).
  WriteRegStr HKCU "Software\Classes\ifcnative" "" "URL:IFCnative"
  WriteRegStr HKCU "Software\Classes\ifcnative" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\ifcnative\DefaultIcon" "" "$\"$INSTDIR\ifcnative.exe$\",0"
  WriteRegStr HKCU "Software\Classes\ifcnative\shell\open\command" "" "$\"$INSTDIR\ifcnative.exe$\" $\"%1$\""
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\ifcnative"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.ifc\shell\IFCnative"
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend
