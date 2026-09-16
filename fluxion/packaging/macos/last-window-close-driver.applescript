-- Test-only real window-close control, never a tab-close keyboard shortcut.
-- The shell also verifies this exact process owns the isolated profile.
on run arguments
  if (count arguments) is not 1 then error "Expected exactly one owned browser PID"
  set ownedPID to (item 1 of arguments) as integer
  if ownedPID < 2 then error "Invalid owned browser PID"
  with timeout of 10 seconds
    tell application "System Events"
      set matches to every application process whose unix id is ownedPID
      if (count matches) is not 1 then error "Owned browser process is not unique"
      set ownedProcess to item 1 of matches
      set frontmost of ownedProcess to true
      repeat 30 times
        if (unix id of first application process whose frontmost is true) is ownedPID then exit repeat
        delay 0.1
      end repeat
      if (unix id of first application process whose frontmost is true) is not ownedPID then error "Owned browser did not receive foreground focus"
      set targets to every window of ownedProcess whose subrole is "AXStandardWindow"
      if (count targets) is not 1 then error "Expected exactly one owned standard browser window"
      set targetWindow to item 1 of targets
      set controls to every button of targetWindow whose subrole is "AXCloseButton"
      if (count controls) is not 1 then error "Owned browser has no unique native close button"
      set closeControl to item 1 of controls
      if not enabled of closeControl then error "Owned native close button is disabled"
      if (unix id of ownedProcess) is not ownedPID then error "Owned process identity changed"
      if (unix id of first application process whose frontmost is true) is not ownedPID then error "Owned browser lost foreground focus"
      perform action "AXPress" of closeControl
    end tell
  end timeout
  return "AXCloseButton-AXPress; ownedPID=" & ownedPID
end run
