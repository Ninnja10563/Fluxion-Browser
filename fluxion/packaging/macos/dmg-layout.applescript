on run arguments
  if (count arguments) is not 2 then error "Expected mode and owned mount path"
  set layoutMode to item 1 of arguments
  set mountPath to item 2 of arguments
  if layoutMode is not "configure" and layoutMode is not "verify" then error "Unknown DMG layout mode"
  set mountedFolder to (POSIX file mountPath) as alias
  tell application "Finder"
    open mountedFolder
    set installWindow to container window of mountedFolder
    if layoutMode is "configure" then
      set current view of installWindow to icon view
      set toolbar visible of installWindow to false
      set statusbar visible of installWindow to false
      set bounds of installWindow to {140, 120, 780, 564}
      set options to icon view options of installWindow
      set arrangement of options to not arranged
      set icon size of options to 96
      set text size of options to 13
      set label position of options to bottom
      set background picture of options to file ".background:background.tiff" of mountedFolder
      set position of item "Fluxion.app" of mountedFolder to {180, 212}
      set position of item "Applications" of mountedFolder to {460, 212}
      close installWindow
      delay 2
      open mountedFolder
      set installWindow to container window of mountedFolder
      set bounds of installWindow to {140, 120, 780, 564}
      update mountedFolder without registering applications
      delay 2
    end if
    set options to icon view options of installWindow
    if current view of installWindow is not icon view then error "DMG did not retain icon view"
    if toolbar visible of installWindow or statusbar visible of installWindow then error "DMG retained unwanted Finder bars"
    if icon size of options is not 96 then error "DMG icon size was not saved"
    if position of item "Fluxion.app" of mountedFolder is not {180, 212} then error "Fluxion icon position was not saved"
    if position of item "Applications" of mountedFolder is not {460, 212} then error "Applications icon position was not saved"
    -- Finder 14 displays the picture but its background-picture getter raises
    -- -10000. The shell verifier checks the actual reopened window pixels.
    set savedBounds to bounds of installWindow
    if (item 3 of savedBounds) - (item 1 of savedBounds) is not 640 then error "DMG width was not saved"
    if (item 4 of savedBounds) - (item 2 of savedBounds) is not 444 then error "DMG height was not saved"
    activate
    return id of installWindow
  end tell
end run
