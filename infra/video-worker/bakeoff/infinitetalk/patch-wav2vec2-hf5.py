#!/usr/bin/env python3
"""Bake-off local patch: transformers 5.x compatibility for the wrapper's
vendored multitalk/wav2vec2.py (see PIN.md, "Local patch").

Why: since transformers 5, Wav2Vec2Encoder.forward takes **kwargs and returns
BaseModelOutput(last_hidden_state=...) ONLY; it never collects per-layer
hidden states (that moved to the @check_model_inputs / OutputRecorder
machinery decorating the stock model classes' forward, which the wrapper's
vendored Wav2Vec2Model subclass bypasses by overriding forward). So
encoder_outputs.hidden_states is None and MultiTalkWav2VecEmbeds crashes at
`torch.stack(embeddings.hidden_states[1:], dim=1)` with
"'NoneType' object is not subscriptable". Verified against transformers
5.16.1 on the bake-off pod, 2026-08-30.

Fix: route the two encoder call sites through a helper that captures each
encoder layer's output with forward hooks and rebuilds the 4.x-style
hidden_states tuple when the encoder did not provide one. Works on both
transformers 4.x (hooks collect, but the encoder's own tuple wins) and 5.x.

Usage: patch-wav2vec2-hf5.py <path-to-wrapper>/multitalk/wav2vec2.py
Idempotent; exits 1 loudly if the pinned file has drifted.
"""
import py_compile
import sys

MARKER = "_encoder_forward_with_hidden_states"

ANCHOR = "# the implementation of Wav2Vec2Model is borrowed from"

HELPER = '''
def _encoder_forward_with_hidden_states(encoder, hidden_states, attention_mask=None,
                                        output_attentions=None, output_hidden_states=None,
                                        return_dict=None):
    """transformers 5.x compatibility (bake-off local patch, see PIN.md).

    transformers 5 moved hidden-state collection out of Wav2Vec2Encoder.forward
    (it returns BaseModelOutput(last_hidden_state=...) only; capture happens via
    decorator machinery on the stock model classes that this vendored subclass
    bypasses). Collect per-layer outputs with forward hooks so
    embeddings.hidden_states[1:] keeps working on transformers 4.x and 5.x.
    Element 0 matches 4.x positionally only; the known consumer
    (MultiTalkWav2VecEmbeds) slices it off.
    """
    collected = []
    handles = []
    if output_hidden_states:
        def _grab(module, args, output):
            collected.append(output[0] if isinstance(output, tuple) else output)
        for layer in encoder.layers:
            handles.append(layer.register_forward_hook(_grab))
    try:
        encoder_outputs = encoder(
            hidden_states,
            attention_mask=attention_mask,
            output_attentions=output_attentions,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
        )
    finally:
        for h in handles:
            h.remove()
    if output_hidden_states and getattr(encoder_outputs, "hidden_states", None) is None and collected:
        encoder_outputs = BaseModelOutput(
            last_hidden_state=encoder_outputs[0],
            hidden_states=(hidden_states,) + tuple(collected),
            attentions=getattr(encoder_outputs, "attentions", None),
        )
    return encoder_outputs


'''

OLD_CALL = """        encoder_outputs = self.encoder(
            hidden_states,
            attention_mask=attention_mask,
            output_attentions=output_attentions,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
        )"""

NEW_CALL = """        encoder_outputs = _encoder_forward_with_hidden_states(
            self.encoder,
            hidden_states,
            attention_mask=attention_mask,
            output_attentions=output_attentions,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
        )"""


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = sys.argv[1]
    with open(path, encoding="utf-8") as f:
        src = f.read()

    if MARKER in src:
        print(f"[skip] {path} already patched ({MARKER} present)")
        return 0

    n = src.count(OLD_CALL)
    if n != 2:
        print(
            f"[FAIL] expected the encoder call block exactly 2x in {path}, found {n}. "
            "The wrapper sha has drifted; re-derive this patch (PIN.md, Local patch).",
            file=sys.stderr,
        )
        return 1
    if ANCHOR not in src:
        print(f"[FAIL] anchor comment not found in {path}; wrapper sha drifted.", file=sys.stderr)
        return 1

    src = src.replace(ANCHOR, HELPER + ANCHOR, 1)
    src = src.replace(OLD_CALL, NEW_CALL)

    with open(path, "w", encoding="utf-8") as f:
        f.write(src)
    py_compile.compile(path, doraise=True)
    print(f"[ ok ] {path} patched for transformers 5.x hidden-states capture")
    return 0


if __name__ == "__main__":
    sys.exit(main())
