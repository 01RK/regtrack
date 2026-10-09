"""预览不写库；提交时重新校验整个包与所有匹配决定。"""
from flask import Blueprint, jsonify, request
from common import ApiError, payload_of
from meeting_actions import review_actions
from meeting_import import validate, preview, commit_import
from meeting_workbook import read_workbook

bp = Blueprint('meeting_imports', __name__, url_prefix='/api/meetings/imports')


@bp.post('/preview')
def inspect():
    return jsonify(preview(read_workbook(request.files.get('file'))))


@bp.post('/review')
def review():
    body = payload_of(request)
    package = validate(body.get('package'))
    decision = body.get('decision')
    if not isinstance(decision, dict):
        raise ApiError('请确认会议及追踪标准')
    meeting_id = decision.get('meeting_id')
    if meeting_id != 'new' and not any(type(meeting_id) is int and m['id']==meeting_id for m in preview(package)['meetings']):
        raise ApiError('请选择推荐会议或新建会议')
    return jsonify(review_actions(package, decision))


@bp.post('')
def create():
    body = payload_of(request)
    return jsonify(commit_import(validate(body.get('package')), body.get('decision'))), 201
