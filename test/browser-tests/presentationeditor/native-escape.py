"""Send a browser-level Escape only while the named test window has X11 focus."""
import ctypes
import ctypes.util
import sys

x11 = ctypes.CDLL(ctypes.util.find_library('X11'))
xtest = ctypes.CDLL(ctypes.util.find_library('Xtst'))
display_type = ctypes.c_void_p
window_type = ctypes.c_ulong

class ClassHint(ctypes.Structure):
    _fields_ = [('res_name', ctypes.c_void_p), ('res_class', ctypes.c_void_p)]

x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = display_type
x11.XGetInputFocus.argtypes = [display_type, ctypes.POINTER(window_type), ctypes.POINTER(ctypes.c_int)]
x11.XGetClassHint.argtypes = [display_type, window_type, ctypes.POINTER(ClassHint)]
x11.XQueryTree.argtypes = [display_type, window_type, ctypes.POINTER(window_type), ctypes.POINTER(window_type), ctypes.POINTER(ctypes.POINTER(window_type)), ctypes.POINTER(ctypes.c_uint)]
x11.XFree.argtypes = [ctypes.c_void_p]
x11.XKeysymToKeycode.argtypes = [display_type, ctypes.c_ulong]
x11.XKeysymToKeycode.restype = ctypes.c_uint
x11.XSync.argtypes = [display_type, ctypes.c_int]
x11.XCloseDisplay.argtypes = [display_type]
xtest.XTestFakeKeyEvent.argtypes = [display_type, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit('An X11 display is required for browser-level Escape')
try:
    focused = window_type()
    revert = ctypes.c_int()
    x11.XGetInputFocus(display, ctypes.byref(focused), ctypes.byref(revert))
    current = focused.value
    matched = False
    for _ in range(30):
        if not current:
            break
        hint = ClassHint()
        if x11.XGetClassHint(display, current, ctypes.byref(hint)):
            values = [ctypes.string_at(value).decode() for value in (hint.res_name, hint.res_class) if value]
            matched = sys.argv[1] in values
            for value in (hint.res_name, hint.res_class):
                if value:
                    x11.XFree(value)
            if matched:
                break
        root, parent = window_type(), window_type()
        children = ctypes.POINTER(window_type)()
        count = ctypes.c_uint()
        if not x11.XQueryTree(display, current, ctypes.byref(root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count)):
            break
        if children:
            x11.XFree(children)
        current = parent.value
    if not matched:
        raise SystemExit('The test browser must have keyboard focus; no key was sent')
    key = x11.XKeysymToKeycode(display, 0xFF1B)
    xtest.XTestFakeKeyEvent(display, key, 1, 0)
    xtest.XTestFakeKeyEvent(display, key, 0, 0)
    x11.XSync(display, 0)
finally:
    x11.XCloseDisplay(display)
