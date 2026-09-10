-- Test-only native keyboard driver for AppKit's remote NSOpenPanel. The
-- service does not expose an AX tree on the CI host; exact OS attribution
-- scopes input, while the parent verifies trusted content events and bytes.
property resolverExecutable : ""
property remotePanelPID : 0

on requireFrontmost(ownedPID)
  tell application "System Events"
    if (unix id of first application process whose frontmost is true) is not ownedPID then error "Owned file-picker process lost foreground focus"
  end tell
end requireFrontmost

on requireNativeAction(ownedPID)
  my requireFrontmost(ownedPID)
  set currentPID to (do shell script (quoted form of resolverExecutable) & " " & ownedPID & " --authorized") as integer
  if remotePanelPID is not 0 and currentPID is not remotePanelPID then error "Native panel's exact OS ownership changed"
  set remotePanelPID to currentPID
end requireNativeAction

on waitForOwnedPanelService(ownedPID)
  set deadline to (current date) + 10
  repeat while (current date) < deadline
    my requireFrontmost(ownedPID)
    try
      my requireNativeAction(ownedPID)
      return
    end try
    delay 0.1
  end repeat
  error "No unique AppKit panel service belongs to the exact browser PID"
end waitForOwnedPanelService

on run arguments
  set actionName to item 1 of arguments
  set ownedPID to (item 2 of arguments) as integer
  set selectedPath to item 3 of arguments
  set resolverExecutable to item 4 of arguments
  set remotePanelPID to 0
  if actionName is not "cancel" and actionName is not "accept" and actionName is not "open" then error "Unknown file-picker driver action"
  -- Chrome has already focused the exact real file input. Do not activate
  -- another window here or replace the input with a synthetic file object.
  my requireFrontmost(ownedPID)
  if actionName is not "open" then
    tell application "System Events" to key code 49
    my waitForOwnedPanelService(ownedPID)
    -- The service can survive between invocations. Allow the new panel to
    -- receive input without changing Gecko's native input-protection delay.
    delay 0.4
  end if
  if actionName is "cancel" then
    my requireNativeAction(ownedPID)
    tell application "System Events" to key code 53
  else if actionName is "accept" then
    my requireNativeAction(ownedPID)
    tell application "System Events" to keystroke "g" using {command down, shift down}
    delay 0.4
    my requireNativeAction(ownedPID)
    do shell script (quoted form of resolverExecutable) & " " & ownedPID & " --type-path " & (quoted form of selectedPath)
    delay 0.2
    my requireNativeAction(ownedPID)
    tell application "System Events" to key code 36
  else
    -- Requested only after the parent proves no selection/change occurred
    -- and the native modal still owns focus. Never blindly send two Returns.
    my requireNativeAction(ownedPID)
    tell application "System Events" to key code 36
  end if
  return actionName & "-native-keyboard-sent; remotePanelPID=" & remotePanelPID
end run
