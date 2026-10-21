/* Opinion history: immutable saved rows and one highlighted pending row. */
(function () {
  "use strict";
  const {esc, today, t, label} = App;
  function table(rows) {
    const sorted = [...rows].sort((a, b) => a.id - b.id);
    return `<div class="opinion-history-scroll"><table class="table opinion-history-table"><thead><tr>
      <th>${label("Status", "状态")}</th><th>${label("Effective Date", "生效日期")}</th><th>${label("Response", "回复")}</th><th>${label("Follow-up", "跟进")}</th><th>${label("Supporting Reference", "依据")}</th><th>${label("Recorded By", "记录人")}</th>
      </tr></thead><tbody>${sorted.map(h => `<tr data-history-id="${h.id}">
      <td><strong>${esc(h.new_value)}</strong>${h.previous_value ? `<small>${t("原状态", "From")} ${esc(h.previous_value)}</small>` : ""}</td>
      <td>${esc(h.effective_date)}<small>${esc(h.recorded_at)}</small></td>
      <td>${esc(h.response || "")}</td><td>${esc(h.follow_up || "")}</td>
      <td>${esc(h.supporting_reference || "")}</td><td>${esc(h.recorded_by)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function mount(host, form, opinion) {
    const section = document.createElement("section");
    section.className = "opinion-status-section";
    section.innerHTML = `<div class="opinion-status-heading"><div><h3>${t("状态更新", "Status updates")}</h3><p>${t("已保存的记录只读。新增一条记录来登记下一次回复或行动。", "Saved records are read-only. Add a new record to document the next response or action.")}</p></div>
      </div>
      <div data-status-subform hidden>${table(opinion.status_history)}
        <div class="opinion-new-row" data-new-status-row><div class="opinion-new-row-heading"><strong>${window.App.uiText("新状态记录", "New status record")}</strong><span>${window.App.uiText("随本次修改一并保存", "Saved with your changes")}</span></div>
          <div class="opinion-status-grid">
            <div><label class="form-label" for="opinion-new-status">${label("New Status", "新状态")} <span class="req">*</span></label>
              <select id="opinion-new-status" class="form-select" data-history-field="new_value"><option value="">${t("选择状态", "Select a status")}</option>
              ${App.meta.comment_statuses.map(v => `<option value="${esc(v)}" ${["Draft", "Submitted"].includes(v) ? 'disabled class="status-unavailable"' : ""}>${esc(v)}</option>`).join("")}</select>
              <small>${t("Draft 与 Submitted 由「需要后续跟进」控制。", "Draft and Submitted are controlled by Follow-up required.")}</small></div>
            <div><label class="form-label" for="opinion-effective-date">${label("Effective Date", "生效日期")} <span class="req">*</span></label><input id="opinion-effective-date" type="date" class="form-control" data-history-field="effective_date" value="${today()}"></div>
            <div><label class="form-label" for="opinion-response">${label("Response", "回复")}</label><textarea id="opinion-response" class="form-control" rows="3" data-history-field="response"></textarea></div>
            <div><label class="form-label" for="opinion-follow-up">${label("Follow-up", "跟进")}</label><textarea id="opinion-follow-up" class="form-control" rows="3" data-history-field="follow_up"></textarea></div>
            <div class="opinion-status-wide"><label class="form-label" for="opinion-reference">${label("Supporting Reference", "依据")}</label><input id="opinion-reference" class="form-control" data-history-field="supporting_reference" placeholder="${t("文件、会议记录或链接", "Document, meeting record or reference link")}"></div>
          </div></div></div>`;
    host.appendChild(section);
    form.opinionStatusSection = section;
    const statusWrap = form.controls.status.el;
    const automatic = t("系统自动", "Automatic");
    statusWrap.classList.add("status-field-with-action");
    statusWrap.innerHTML = `<span class="status-field-value">${esc(opinion.status)}<em>${automatic}</em></span><button type="button" class="btn btn-outline-primary btn-sm" data-status-toggle aria-expanded="false">${window.App.uiText("更新状态", "Update status")}</button>`;
    const toggle = statusWrap.querySelector("[data-status-toggle]");
    const subform = section.querySelector("[data-status-subform]");
    const flag = form.controls.needs_follow_up.el;
    let flagBeforeUpdate = flag.checked;
    // Keep the current status label in sync with the follow-up control.

    const preview = () => {
      const status = flag.checked === !!opinion.needs_follow_up ? opinion.status : (flag.checked ? "Submitted" : "Draft");
      statusWrap.querySelector(".status-field-value").innerHTML = `${esc(status)}<em>${automatic}</em>`;
    };
    flag.addEventListener("change", preview);
    toggle.onclick = () => {
      const expanding = subform.hidden;
      subform.hidden = !expanding;
      toggle.setAttribute("aria-expanded", String(expanding));
      toggle.textContent = expanding ? t("取消更新", "Cancel update") : t("更新状态", "Update status");
      if (expanding) {
        flagBeforeUpdate = flag.checked;
        flag.checked = true; flag.disabled = true; preview();
        section.querySelector("#opinion-new-status").focus();
      } else {
        flag.disabled = false; flag.checked = flagBeforeUpdate; preview();
        section.querySelectorAll("[data-history-field]").forEach(el => {el.value = el.type === "date" ? today() : "";});
      }
    };
  }
  function read(form) {
    const section = form.opinionStatusSection;
    if (section.querySelector("[data-status-subform]").hidden) return null;
    const payload = {};
    section.querySelectorAll("[data-history-field]").forEach(el => payload[el.dataset.historyField] = el.value.trim());
    for (const field of ["new_value", "effective_date"]) {
      if (!payload[field]) {
        section.querySelector(`[data-history-field="${field}"]`).focus();
        throw new Error(field === "new_value" ? t("请选择新状态。", "Select a new status.") : t("请填写生效日期。", "Effective Date is required."));
      }
    }
    return payload;
  }
  window.OpinionHistory = {table, mount, read};
})();
