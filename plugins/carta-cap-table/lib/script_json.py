"""JSON that is safe to embed in a page's <script> block."""
import json


def script_json(value):
    """Serialize `value` so no sequence in it can close the tag or open a comment
    (`<`, `>`, `&` escaped), and U+2028/U+2029 stay escaped."""
    text = json.dumps(value, ensure_ascii=False)
    return (
        text.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )
