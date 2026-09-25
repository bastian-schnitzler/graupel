import sys
import typer
from .API import API
from .config import (
    LOGFILE_PATH_UI,
    LOGFILE_PATH_PY,
    LOGGING,
)
from .resources import frontend_directory, icon_path
from .windows_integration import set_app_user_model_id

app = typer.Typer(invoke_without_command=True)


@app.callback()
def main(ctx: typer.Context) -> None:
    if ctx.invoked_subcommand is None:

        set_app_user_model_id()
        import webview

        api = API(
            LOGFILE_PATH_PY if LOGGING else None,
            LOGFILE_PATH_UI if LOGGING else None,
        )

        # Resolve the application icon (Windows only; gracefully ignored
        # on other platforms and when the icon file cannot be found).
        start_icon: str | None = None
        if sys.platform == "win32":
            try:
                start_icon = str(icon_path())
            except Exception as exc:  # noqa: BLE001
                print(f"[graupel] Could not locate icon: {exc}", file=sys.stderr)

        try:

            with frontend_directory() as frontend:
                webview.create_window(
                    "Graupel",
                    str(frontend / "index.html"),
                    resizable=True,
                    maximized=True,
                    js_api=api,
                )

                webview.start(icon=start_icon)
        except Exception as e:
            print(e)
            if LOGGING:
                api.log.error(
                    "Backend error",
                    error=str(e),
                    error_type=type(e).__name__,
                )

        # After the webview session ends, set up the Start Menu shortcut.
        # This runs only on Windows, only for installed packages, and never
        # raises — errors are logged but do not affect the exit code.
        if sys.platform == "win32":
            try:
                from .windows_integration import (
                    ensure_start_menu_shortcut,
                )

                ensure_start_menu_shortcut()
            except Exception as exc:  # noqa: BLE001
                print(
                    f"[graupel] Start Menu shortcut setup failed: {exc}",
                    file=sys.stderr,
                )


if __name__ == "__main__":
    app()
