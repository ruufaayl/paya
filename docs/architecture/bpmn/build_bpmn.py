"""Generates payment-journey.bpmn (BPMN 2.0 with diagram interchange) for bpmn.io / Camunda Modeler.

Keeping the model as code makes it reviewable in pull requests and keeps lanes, IDs and labels
consistent with the state machine. Run:  python docs/architecture/bpmn/build_bpmn.py
"""
from pathlib import Path
from xml.sax.saxutils import escape

LANES = ["Digital channel & gateway", "Risk engine (automated)", "Compliance officer",
         "Ledger & rail integration (automated)", "Recovery worker (automated)", "Operations (maker)",
         "Finance (checker & reconciliation)"]
LANE_HS = [150, 150, 170, 240, 230, 150, 170]
LANE_TOP = [30 + sum(LANE_HS[:i]) for i in range(len(LANE_HS))]
X0, COL = 190, 160
LANE_ID = {n: f"Lane_{i}" for i, n in enumerate(LANES)}

# id: (type, label, lane index, column, vertical offset inside the lane)
N = {
    "start":      ("startEvent", "Customer submits payment for QR", 0, 0, 0),
    "validate":   ("task", "Validate JWT, payload, Idempotency-Key", 0, 1, 0),
    "gw_live":    ("exclusiveGateway", "Live payment already exists for this QR?", 0, 2, 0),
    "end_exist":  ("endEvent", "Existing payment returned (409) - no new debit", 0, 3, 0),
    "screen":     ("businessRuleTask", "Screen KYC tier, limit, velocity, watch-list", 1, 3, 0),
    "gw_risk":    ("exclusiveGateway", "Risk outcome?", 1, 4, 0),
    "end_rej":    ("endEvent", "Declined - no money moved", 1, 5, 0),
    "review":     ("userTask", "Review hold with screening evidence", 2, 5, -10),
    "gw_comp":    ("exclusiveGateway", "Compliance decision?", 2, 6, -10),
    "esc":        ("endEvent:escalation", "Escalated to compliance lead", 2, 7, 52),
    "end_crej":   ("endEvent", "Rejected by compliance - evidence kept", 2, 8, -30),
    "post":       ("serviceTask", "Reserve funds, post AUTH_POST (Dr wallet / Cr in transit)", 3, 7, 0),
    "gw_funds":   ("exclusiveGateway", "Funds available?", 3, 8, 0),
    "end_nsf":    ("endEvent", "Declined - insufficient funds", 3, 8, 78),
    "send":       ("sendTask", "Send credit to Raast with E2E id (PENDING)", 3, 9, 0),
    "evgw":       ("eventBasedGateway", "", 3, 10, 0),
    "msg_ok":     ("intermediateCatchEvent:message", "Rail ACCEPTED", 3, 11, -60),
    "msg_rej":    ("intermediateCatchEvent:message", "Rail REJECTED", 3, 11, 60),
    "settle":     ("serviceTask", "Post SETTLE + FEE journals (SETTLED)", 3, 13, -60),
    "notify":     ("intermediateThrowEvent:message", "Notify customer & cashier: PAID", 3, 14, -60),
    "reverse":    ("serviceTask", "Post compensating REVERSAL (Dr in transit / Cr wallet)", 3, 15, 60),
    "end_rev":    ("endEvent", "Returned to wallet", 3, 16, 60),
    "tmr":        ("intermediateCatchEvent:timer", "Timeout / backoff elapsed - outcome unknown", 4, 10, -35),
    "enquiry":    ("serviceTask", "Status enquiry (never blind resend)", 4, 11, -35),
    "gw_enq":     ("exclusiveGateway", "Enquiry answer?", 4, 12, -35),
    "resend":     ("serviceTask", "Resend SAME E2E id", 4, 13, 45),
    "maker":      ("userTask", "Request reversal (maker)", 5, 13, 0),
    "checker":    ("userTask", "Approve reversal (checker, not maker)", 6, 14, -10),
    "recon":      ("serviceTask", "Reconcile with Raast settlement file (D+1)", 6, 15, -10),
    "gw_match":   ("exclusiveGateway", "Matched?", 6, 16, -10),
    "end_recon":  ("endEvent", "RECONCILED", 6, 17, -10),
    "brk":        ("userTask", "Resolve recon break (owner, SLA, evidence)", 5, 17, 0),
    "end_break":  ("endEvent", "Break closed with resolution evidence", 5, 18, 0),
}
BOUNDARY = {"b_sla": ("timer", "4 h SLA breached", "review", "esc")}

F = [  # (from, to, label)
    ("start", "validate", ""), ("validate", "gw_live", ""), ("gw_live", "end_exist", "yes"),
    ("gw_live", "screen", "no"), ("screen", "gw_risk", ""), ("gw_risk", "end_rej", "REJECT"),
    ("gw_risk", "review", "HOLD"), ("gw_risk", "post", "PASS"), ("review", "gw_comp", ""),
    ("gw_comp", "end_crej", "reject"), ("gw_comp", "post", "release"), ("post", "gw_funds", ""),
    ("gw_funds", "end_nsf", "no"), ("gw_funds", "send", "yes"), ("send", "evgw", ""),
    ("evgw", "msg_ok", ""), ("evgw", "msg_rej", ""), ("evgw", "tmr", ""),
    ("msg_ok", "settle", ""), ("settle", "notify", ""), ("notify", "recon", "D+1"), ("recon", "gw_match", ""),
    ("gw_match", "end_recon", "yes"), ("gw_match", "brk", "no"), ("brk", "end_break", ""),
    ("msg_rej", "reverse", ""), ("reverse", "end_rev", ""),
    ("tmr", "enquiry", ""), ("enquiry", "gw_enq", ""), ("gw_enq", "settle", "ACCEPTED"),
    ("gw_enq", "reverse", "REJECTED"), ("gw_enq", "resend", "NOT_FOUND"), ("resend", "tmr", "wait backoff"),
    ("gw_enq", "maker", "unknown > 15 min"), ("maker", "checker", ""), ("checker", "reverse", "approved"),
]
DATA = {  # data object: (label, attached-to task, lane, col offset)
    "d_idem": ("Idempotency record", "validate"), "d_scr": ("Screening result + rules fired", "screen"),
    "d_case": ("Compliance case + decision reason", "review"), "d_jrnl": ("Ledger journal (balanced)", "post"),
    "d_file": ("Settlement file (count, total, SHA-256)", "recon"), "d_appr": ("Approval (maker != checker)", "maker"),
}

SIZE = {"task": (130, 80), "gw": (50, 50), "ev": (36, 36)}


def kind(t):
    if "Gateway" in t:
        return "gw"
    if "Event" in t:
        return "ev"
    return "task"


def box(nid):
    t, _, lane, col, dy = N[nid]
    w, h = SIZE[kind(t)]
    cx, cy = X0 + 70 + col * COL, LANE_TOP[lane] + LANE_HS[lane] / 2 + dy
    return cx - w / 2, cy - h / 2, w, h


def el(nid):
    t, label, *_ = N[nid]
    base, _, sub = t.partition(":")
    attrs = f'id="{nid}" name="{escape(label)}"'
    inner = "".join(f"<bpmn:incoming>f_{i}</bpmn:incoming>" for i, f in enumerate(F) if f[1] == nid)
    inner += "".join(f"<bpmn:outgoing>f_{i}</bpmn:outgoing>" for i, f in enumerate(F) if f[0] == nid)
    if nid == "esc":
        inner = f"<bpmn:incoming>f_b</bpmn:incoming>"
    if sub == "message":
        inner += f'<bpmn:messageEventDefinition id="{nid}_def" />'
    elif sub == "timer":
        inner += f'<bpmn:timerEventDefinition id="{nid}_def"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT8S</bpmn:timeDuration></bpmn:timerEventDefinition>'
    elif sub == "escalation":
        inner += f'<bpmn:escalationEventDefinition id="{nid}_def" />'
    for did, (_, task) in DATA.items():
        if task == nid:
            inner += f'<bpmn:dataOutputAssociation id="a_{did}"><bpmn:targetRef>{did}</bpmn:targetRef></bpmn:dataOutputAssociation>'
    return f"<bpmn:{base} {attrs}>{inner}</bpmn:{base}>"


def mid(nid, side):
    x, y, w, h = box(nid)
    return {"r": (x + w, y + h / 2), "l": (x, y + h / 2), "t": (x + w / 2, y), "b": (x + w / 2, y + h)}[side]


def waypoints(a, b):
    ax, ay, aw, ah = box(a)
    bx, by, bw, bh = box(b)
    acx, acy, bcx, bcy = ax + aw / 2, ay + ah / 2, bx + bw / 2, by + bh / 2
    if abs(acx - bcx) < 1:  # same column: straight vertical
        return [mid(a, "b"), mid(b, "t")] if bcy > acy else [mid(a, "t"), mid(b, "b")]
    if bcx > acx:  # forward
        if "Gateway" in N[a][0] and abs(acy - bcy) > 1:  # gateways branch up/down, then across
            s = mid(a, "b") if bcy > acy else mid(a, "t")
            return [s, (s[0], bcy), mid(b, "l")]
        s, e = mid(a, "r"), mid(b, "l")
        mx = (s[0] + e[0]) / 2
        return [s, (mx, s[1]), (mx, e[1]), e] if abs(s[1] - e[1]) > 1 else [s, e]
    # backward (loop): leave from below, run underneath, enter the target from below
    s = mid(a, "b")
    off = max(ay + ah, by + bh) + 18
    return [s, (s[0], off), (bcx, off), mid(b, "b")]


def build() -> str:
    width = X0 + 70 + 19 * COL
    lanes_xml = "".join(
        f'<bpmn:lane id="{LANE_ID[l]}" name="{escape(l)}">' +
        "".join(f"<bpmn:flowNodeRef>{n}</bpmn:flowNodeRef>" for n, v in N.items() if v[2] == i) +
        ("<bpmn:flowNodeRef>b_sla</bpmn:flowNodeRef>" if i == 2 else "") + "</bpmn:lane>"
        for i, l in enumerate(LANES))
    flows = "".join(
        f'<bpmn:sequenceFlow id="f_{i}" sourceRef="{a}" targetRef="{b}"' + (f' name="{escape(lbl)}"' if lbl else "") + " />"
        for i, (a, b, lbl) in enumerate(F))
    flows += '<bpmn:sequenceFlow id="f_b" sourceRef="b_sla" targetRef="esc" />'
    boundary = ('<bpmn:boundaryEvent id="b_sla" name="4 h SLA breached" attachedToRef="review" cancelActivity="false">'
                '<bpmn:outgoing>f_b</bpmn:outgoing><bpmn:timerEventDefinition id="b_sla_def"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT4H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>')
    data = "".join(f'<bpmn:dataObjectReference id="{d}" name="{escape(l)}" dataObjectRef="{d}_obj" /><bpmn:dataObject id="{d}_obj" />'
                   for d, (l, _) in DATA.items())
    process = (f'<bpmn:process id="Process_Paya" name="Paya QR merchant payment" isExecutable="false">'
               f'<bpmn:laneSet id="LaneSet_1">{lanes_xml}</bpmn:laneSet>'
               + "".join(el(n) for n in N) + boundary + data + flows + "</bpmn:process>")
    collab = ('<bpmn:collaboration id="Collab_1">'
              '<bpmn:participant id="P_Customer" name="Customer (wallet app)" />'
              '<bpmn:participant id="P_Paya" name="Paya (on behalf of Partner EMI)" processRef="Process_Paya" />'
              '<bpmn:participant id="P_Raast" name="Raast P2M rail (simulated)" />'
              '<bpmn:messageFlow id="mf_pay" name="Pay (Idempotency-Key)" sourceRef="P_Customer" targetRef="start" />'
              '<bpmn:messageFlow id="mf_credit" name="Credit transfer" sourceRef="send" targetRef="P_Raast" />'
              '<bpmn:messageFlow id="mf_ack" name="ACCEPTED" sourceRef="P_Raast" targetRef="msg_ok" />'
              '<bpmn:messageFlow id="mf_status" name="Status: Paid" sourceRef="notify" targetRef="P_Customer" />'
              "</bpmn:collaboration>")

    pool_y, pool_h = 30, sum(LANE_HS)
    di = [f'<bpmndi:BPMNShape id="P_Paya_di" bpmnElement="P_Paya" isHorizontal="true"><dc:Bounds x="{X0 - 60}" y="{pool_y}" width="{width}" height="{pool_h}" /></bpmndi:BPMNShape>',
          f'<bpmndi:BPMNShape id="P_Customer_di" bpmnElement="P_Customer" isHorizontal="true"><dc:Bounds x="{X0 - 60}" y="-110" width="{width}" height="70" /></bpmndi:BPMNShape>',
          f'<bpmndi:BPMNShape id="P_Raast_di" bpmnElement="P_Raast" isHorizontal="true"><dc:Bounds x="{X0 - 60}" y="{pool_y + pool_h + 40}" width="{width}" height="70" /></bpmndi:BPMNShape>']
    for i, l in enumerate(LANES):
        di.append(f'<bpmndi:BPMNShape id="{LANE_ID[l]}_di" bpmnElement="{LANE_ID[l]}" isHorizontal="true"><dc:Bounds x="{X0 - 30}" y="{LANE_TOP[i]}" width="{width - 30}" height="{LANE_HS[i]}" /></bpmndi:BPMNShape>')
    for n, (t, *_rest) in N.items():
        x, y, w, h = box(n)
        mark = ' isMarkerVisible="true"' if t == "exclusiveGateway" else ""
        lbl = "" if kind(t) == "task" else f'<bpmndi:BPMNLabel><dc:Bounds x="{x - 30}" y="{y + h + 4}" width="{w + 60}" height="27" /></bpmndi:BPMNLabel>'
        di.append(f'<bpmndi:BPMNShape id="{n}_di" bpmnElement="{n}"{mark}><dc:Bounds x="{x}" y="{y}" width="{w}" height="{h}" />{lbl}</bpmndi:BPMNShape>')
    rx, ry, rw, rh = box("review")
    di.append(f'<bpmndi:BPMNShape id="b_sla_di" bpmnElement="b_sla"><dc:Bounds x="{rx + rw - 30}" y="{ry + rh - 18}" width="36" height="36" /></bpmndi:BPMNShape>')
    ex, ey, ew, eh = box("esc")
    di.append(f'<bpmndi:BPMNEdge id="f_b_di" bpmnElement="f_b"><di:waypoint x="{rx + rw - 12}" y="{ry + rh + 18}" /><di:waypoint x="{rx + rw - 12}" y="{ry + rh + 40}" /><di:waypoint x="{ex + ew / 2}" y="{ry + rh + 40}" /><di:waypoint x="{ex + ew / 2}" y="{ey + eh}" /></bpmndi:BPMNEdge>')
    for d, (_, task) in DATA.items():
        tx, ty, tw, th = box(task)
        dx, dy = tx + tw / 2 + 22, ty - 52 if N[task][2] != 0 else ty + th + 14
        dy = ty + th + 6 if N[task][2] == 0 else ty - 50
        di.append(f'<bpmndi:BPMNShape id="{d}_di" bpmnElement="{d}"><dc:Bounds x="{dx}" y="{dy}" width="30" height="40" /><bpmndi:BPMNLabel><dc:Bounds x="{dx + 34}" y="{dy + 4}" width="110" height="30" /></bpmndi:BPMNLabel></bpmndi:BPMNShape>')
        di.append(f'<bpmndi:BPMNEdge id="a_{d}_di" bpmnElement="a_{d}"><di:waypoint x="{tx + tw / 2 + 10}" y="{ty if dy < ty else ty + th}" /><di:waypoint x="{dx + 6}" y="{dy + 40 if dy < ty else dy}" /></bpmndi:BPMNEdge>')
    for i, (a, b, lbl) in enumerate(F):
        pts = waypoints(a, b)
        wp = "".join(f'<di:waypoint x="{round(px)}" y="{round(py)}" />' for px, py in pts)
        lab = ""
        if lbl:
            if len(pts) == 4 and pts[0][0] > pts[3][0]:  # loop: label on the return leg
                lx, ly = pts[2][0] + 8, pts[2][1] - 16
            elif len(pts) == 3:      # gateway branch: label at the bend, where branches have separated
                lx, ly = pts[1][0] + 8, pts[1][1] - 2
            elif len(pts) == 2 and pts[0][0] == pts[1][0]:  # vertical: label beside the midpoint
                lx, ly = pts[0][0] + 6, (pts[0][1] + pts[1][1]) / 2 + 6
            else:
                lx, ly = pts[0][0] + 6, pts[0][1]
            lab = f'<bpmndi:BPMNLabel><dc:Bounds x="{round(lx) + 4}" y="{round(ly) - 16}" width="70" height="14" /></bpmndi:BPMNLabel>'
        di.append(f'<bpmndi:BPMNEdge id="f_{i}_di" bpmnElement="f_{i}">{wp}{lab}</bpmndi:BPMNEdge>')
    # message flows
    sx, sy, sw, sh = box("start"); di.append(f'<bpmndi:BPMNEdge id="mf_pay_di" bpmnElement="mf_pay"><di:waypoint x="{sx + sw / 2}" y="-40" /><di:waypoint x="{sx + sw / 2}" y="{sy}" /></bpmndi:BPMNEdge>')
    nx, ny, nw, nh = box("notify"); di.append(f'<bpmndi:BPMNEdge id="mf_status_di" bpmnElement="mf_status"><di:waypoint x="{nx + nw / 2}" y="{ny}" /><di:waypoint x="{nx + nw / 2}" y="-40" /></bpmndi:BPMNEdge>')
    rpool = pool_y + pool_h + 40
    cx, cy, cw, ch = box("send"); di.append(f'<bpmndi:BPMNEdge id="mf_credit_di" bpmnElement="mf_credit"><di:waypoint x="{cx + cw / 2}" y="{cy + ch}" /><di:waypoint x="{cx + cw / 2}" y="{rpool}" /></bpmndi:BPMNEdge>')
    ox, oy, ow, oh = box("msg_ok"); ax = ox + ow / 2 + 60
    di.append(f'<bpmndi:BPMNEdge id="mf_ack_di" bpmnElement="mf_ack"><di:waypoint x="{ax}" y="{rpool}" /><di:waypoint x="{ax}" y="{oy - 18}" /><di:waypoint x="{ox + ow / 2}" y="{oy - 18}" /><di:waypoint x="{ox + ow / 2}" y="{oy}" /></bpmndi:BPMNEdge>')

    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
            'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
            'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'id="Defs_Paya" targetNamespace="https://paya.local/bpmn" exporter="paya build_bpmn.py" exporterVersion="1">'
            + collab + process +
            '<bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">' + "".join(di) +
            "</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>\n")


if __name__ == "__main__":
    out = Path(__file__).with_name("payment-journey.bpmn")
    out.write_text(build())
    print(f"wrote {out}")
