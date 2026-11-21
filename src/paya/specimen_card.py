"""Render a SYNTHETIC specimen identity card for tests, documentation and demos.

The layout is deliberately Paya's own (purple header, large SPECIMEN watermark, SPX- number) and does not
imitate any government identity card. The phone app draws the same design on the device.
"""
from datetime import date

import cv2
import numpy as np

W, H = 1012, 638  # ID-1 card proportions (85.6 x 54 mm)
PURPLE = (153, 51, 102)  # BGR
INK = (40, 30, 30)


def render(*, full_name: str, date_of_birth: date, specimen_id: str, expires_on: date, qr_payload: str,
           photo: np.ndarray | None = None) -> np.ndarray:
    card = np.full((H, W, 3), 245, np.uint8)
    # soft texture so the card is not a flat colour (and so sharpness is measurable)
    yy, xx = np.mgrid[0:H, 0:W]
    card[:] = (245 - (np.sin(xx / 9.0) * np.cos(yy / 11.0) * 6)).astype(np.uint8)[..., None]
    cv2.rectangle(card, (0, 0), (W, 96), PURPLE, -1)
    cv2.putText(card, "PAYA", (32, 64), cv2.FONT_HERSHEY_DUPLEX, 1.6, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(card, "SYNTHETIC TEST IDENTITY - NOT AN IDENTITY DOCUMENT", (210, 60), cv2.FONT_HERSHEY_SIMPLEX,
                0.72, (255, 255, 255), 2, cv2.LINE_AA)
    # photo box
    x0, y0, pw, ph = 36, 128, 260, 330
    if photo is not None:
        card[y0:y0 + ph, x0:x0 + pw] = cv2.resize(photo, (pw, ph))
    else:
        cv2.rectangle(card, (x0, y0), (x0 + pw, y0 + ph), (210, 200, 205), -1)
        cv2.circle(card, (x0 + pw // 2, y0 + 120), 62, (170, 160, 165), -1)
        cv2.ellipse(card, (x0 + pw // 2, y0 + ph), (110, 120), 0, 180, 360, (170, 160, 165), -1)
    cv2.rectangle(card, (x0, y0), (x0 + pw, y0 + ph), PURPLE, 3)
    fields = [("NAME", full_name), ("DATE OF BIRTH", date_of_birth.isoformat()),
              ("SPECIMEN NO.", specimen_id), ("VALID UNTIL", expires_on.isoformat())]
    y = 150
    for label, value in fields:
        cv2.putText(card, label, (330, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (110, 90, 110), 1, cv2.LINE_AA)
        cv2.putText(card, value, (330, y + 36), cv2.FONT_HERSHEY_DUPLEX, 0.95, INK, 2, cv2.LINE_AA)
        y += 84
    qr = cv2.QRCodeEncoder.create().encode(qr_payload)
    qr = cv2.resize(qr, (250, 250), interpolation=cv2.INTER_NEAREST)
    qr = cv2.copyMakeBorder(qr, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255)
    qx, qy = W - qr.shape[1] - 30, 150
    card[qy:qy + qr.shape[0], qx:qx + qr.shape[1]] = cv2.cvtColor(qr, cv2.COLOR_GRAY2BGR)
    # diagonal SPECIMEN watermark, drawn semi-transparently so it never hides the code
    overlay = np.zeros_like(card)
    cv2.putText(overlay, "SPECIMEN", (120, 520), cv2.FONT_HERSHEY_DUPLEX, 4.2, (60, 60, 230), 10, cv2.LINE_AA)
    m = cv2.getRotationMatrix2D((W / 2, H / 2), 14, 1.0)
    overlay = cv2.warpAffine(overlay, m, (W, H))
    mask = overlay.any(axis=2)
    mask[qy:qy + qr.shape[0], qx:qx + qr.shape[1]] = False
    card[mask] = (0.55 * card[mask] + 0.45 * overlay[mask]).astype(np.uint8)
    cv2.putText(card, "Prototype for FAST CS3017. Synthetic data only.", (36, H - 30), cv2.FONT_HERSHEY_SIMPLEX,
                0.6, (110, 90, 110), 1, cv2.LINE_AA)
    return card
