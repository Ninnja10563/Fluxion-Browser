-- Test-only OS input driver. No browser APIs, clipboard, or picker replacement.
property resolverExecutable : ""
property remotePanelPID : 0

on requireNativeAction(ownedPID)
  my requireFrontmost(ownedPID)
  if remotePanelPID is not 0 then
    set currentPID to (do shell script (quoted form of resolverExecutable) & " " & ownedPID & " --authorized") as integer
    if currentPID is not remotePanelPID then error "Native panel's exact OS ownership changed"
  end if
end requireNativeAction

on requireFrontmost(ownedPID)
  tell application "System Events"
    if (unix id of first application process whose frontmost is true) is not ownedPID then error "Owned file-picker process lost foreground focus"
  end tell
end requireFrontmost

on ownedSheet(ownedPID)
  tell application "System Events"
    tell first application process whose unix id is ownedPID
      -- AppKit may host NSOpenPanel remotely. Follow only focus references
      -- supplied by this owned application, never enumerate other processes.
      repeat with focusAttribute in {"AXFocusedWindow", "AXFocusedUIElement"}
        try
          set focusNode to value of attribute (contents of focusAttribute)
          repeat 12 times
            set focusRole to value of attribute "AXRole" of focusNode
            if focusRole is "AXSheet" then return focusNode
            if focusRole is "AXWindow" then
              if (value of attribute "AXSubrole" of focusNode) is "AXDialog" then return focusNode
            end if
            set focusNode to value of attribute "AXParent" of focusNode
          end repeat
        end try
      end repeat
      repeat with candidateWindow in windows
        if (count of sheets of candidateWindow) > 0 then return sheet 1 of candidateWindow
        -- AppKit can expose a sheet below intermediary accessibility groups,
        -- rather than as a direct child of the browser AXWindow.
        repeat with descendant in entire contents of candidateWindow
          try
            if (value of attribute "AXRole" of descendant) is "AXSheet" then return contents of descendant
          end try
        end repeat
      end repeat
    end tell
  end tell
  -- A remote panel is accepted only after OS responsibility identifies one
  -- exact protected-system helper owned by this browser, not its CI ancestor.
  try
    set candidatePID to (do shell script (quoted form of resolverExecutable) & " " & ownedPID & " --authorized") as integer
  on error
    return missing value
  end try
  tell application "System Events"
    set remoteProcess to first application process whose unix id is candidatePID
    repeat with candidateWindow in windows of remoteProcess
      if (value of attribute "AXRole" of candidateWindow) is "AXSheet" then
        set remotePanelPID to candidatePID
        return contents of candidateWindow
      end if
      if (value of attribute "AXSubrole" of candidateWindow) is "AXDialog" then
        set remotePanelPID to candidatePID
        return contents of candidateWindow
      end if
      repeat with descendant in entire contents of candidateWindow
        try
          if (value of attribute "AXRole" of descendant) is "AXSheet" then
            set remotePanelPID to candidatePID
            return contents of descendant
          end if
        end try
      end repeat
    end repeat
  end tell
  return missing value
end ownedSheet

on ownedWindowSummary(ownedPID)
  tell application "System Events"
    tell first application process whose unix id is ownedPID
      set summary to "windows=" & (count of windows)
      repeat with focusAttribute in {"AXFocusedWindow", "AXFocusedUIElement"}
        try
          set focusNode to value of attribute (contents of focusAttribute)
          set summary to summary & "; " & (contents of focusAttribute) & " lineage="
          repeat 8 times
            set summary to summary & (value of attribute "AXRole" of focusNode) & "/"
            set focusNode to value of attribute "AXParent" of focusNode
          end repeat
        on error errorText number errorNumber
          set summary to summary & " stop=" & errorNumber & ":" & errorText
        end try
      end repeat
      repeat with candidateWindow in windows
        set summary to summary & "; sheets=" & (count of sheets of candidateWindow)
        try
          set summary to summary & "; windowRole=" & (value of attribute "AXRole" of candidateWindow)
          set summary to summary & "; AXChildren=" & (count of (value of attribute "AXChildren" of candidateWindow))
        on error errorText number errorNumber
          set summary to summary & "; windowReadError=" & errorNumber & ":" & errorText
        end try
        set roles to {}
        set descendants to entire contents of candidateWindow
        set summary to summary & "; descendants=" & (count of descendants)
        set firstReadError to ""
        repeat with descendant in descendants
          try
            set roleName to value of attribute "AXRole" of descendant
            if roles does not contain roleName then set end of roles to roleName
          on error errorText number errorNumber
            if firstReadError is "" then set firstReadError to errorNumber & ":" & errorText
          end try
        end repeat
        set summary to summary & "; descendant roles=" & (roles as text) & "; firstReadError=" & firstReadError
      end repeat
      return summary
    end tell
  end tell
end ownedWindowSummary

on run arguments
  set actionName to item 1 of arguments
  set ownedPID to (item 2 of arguments) as integer
  set resolverExecutable to item 4 of arguments
  set remotePanelPID to 0
  if actionName is not "cancel" and actionName is not "accept" then error "Unknown file-picker driver action"
  tell application "System Events"
    set ownedProcess to first application process whose unix id is ownedPID
    set frontmost of ownedProcess to true
    -- Gecko's supported AT detection initializes its accessibility tree when
    -- the application's role is read (accessible/mac/Platform.mm).
    set applicationRole to value of attribute "AXRole" of ownedProcess
    if applicationRole is not "AXApplication" then error "Owned fixture is not an AX application"
  end tell
  delay 0.3
  my requireFrontmost(ownedPID)
  if my ownedSheet(ownedPID) is not missing value then error "Unexpected pre-existing sheet in owned fixture"
  my requireNativeAction(ownedPID)
  tell application "System Events" to key code 49
  set pickerSheet to missing value
  repeat 100 times
    my requireFrontmost(ownedPID)
    set pickerSheet to my ownedSheet(ownedPID)
    if pickerSheet is not missing value then exit repeat
    delay 0.1
  end repeat
  if pickerSheet is missing value then error "Native file picker did not expose an owned AX sheet: " & my ownedWindowSummary(ownedPID)
  if actionName is "cancel" then
    my requireNativeAction(ownedPID)
    tell application "System Events" to key code 53
  else
    set selectedPath to item 3 of arguments
    my requireNativeAction(ownedPID)
    tell application "System Events" to keystroke "g" using {command down, shift down}
    set pathControl to missing value
    repeat 100 times
      my requireFrontmost(ownedPID)
      set pickerSheet to my ownedSheet(ownedPID)
      if pickerSheet is missing value then error "Owned native panel lost its accessibility focus relationship during Go to Folder"
      tell application "System Events"
        tell first application process whose unix id is ownedPID
          set candidates to entire contents of pickerSheet
          repeat with candidate in candidates
            try
              set candidateRole to value of attribute "AXRole" of candidate
              if candidateRole is "AXTextField" or candidateRole is "AXComboBox" then
                if (value of attribute "AXFocused" of candidate) is true and enabled of candidate then
                  set pathControl to contents of candidate
                  exit repeat
                end if
              end if
            end try
          end repeat
        end tell
      end tell
      if pathControl is not missing value then exit repeat
      delay 0.1
    end repeat
    if pathControl is missing value then error "Go to Folder did not expose a focused editable AX path control"
    my requireNativeAction(ownedPID)
    tell application "System Events" to set value of pathControl to selectedPath
    my requireNativeAction(ownedPID)
    tell application "System Events" to key code 36
    -- Resolve the typed path first; press the native panel's enabled Open
    -- action, never a content control or an arbitrary default button.
    set openButton to missing value
    repeat 100 times
      my requireFrontmost(ownedPID)
      set pickerSheet to my ownedSheet(ownedPID)
      if pickerSheet is missing value then exit repeat
      tell application "System Events"
        set pathStillFocused to false
        try
          set pathStillFocused to value of attribute "AXFocused" of pathControl
        end try
        if pathStillFocused is false then
          repeat with candidate in entire contents of pickerSheet
            try
              if (value of attribute "AXRole" of candidate) is "AXButton" and name of candidate is "Open" and enabled of candidate then
                set openButton to contents of candidate
                exit repeat
              end if
            end try
          end repeat
        end if
      end tell
      if openButton is not missing value then exit repeat
      delay 0.1
    end repeat
    if pickerSheet is not missing value then
      if openButton is missing value then error "Native picker did not expose an enabled Open action"
      my requireNativeAction(ownedPID)
      tell application "System Events" to perform action "AXPress" of openButton
    end if
  end if
  repeat 100 times
    my requireFrontmost(ownedPID)
    if my ownedSheet(ownedPID) is missing value then return actionName & "-native-sheet-dismissed; remotePanelPID=" & remotePanelPID
    delay 0.1
  end repeat
  error "Native file picker remained open after its requested action"
end run
