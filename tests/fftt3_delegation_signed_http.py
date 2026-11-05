#!/usr/bin/env python3
"""Exact delegation candidate against independent, fictional LOCAL GoTrue sessions only."""
import json
import uuid
from b2c_auth_concurrency import ensure, local_status, request, sql, denied
from gameday_signed_http import make_user


def run():
    api, anon, db = local_status()  # Rejects every non-loopback endpoint.
    users = {}
    for label in ('organizer', 'manager', 'score-a', 'score-b', 'outsider', 'revoked'):
        uid, email, token = make_user(api, anon, 'delegate-' + label)
        me = request(api, anon, 'GET', '/auth/v1/user', token=token)
        ensure(me.code == 200 and me.body.get('id') == uid, label + ' independently authenticated')
        users[label] = (uid, email, token)
    sql(db, "insert into fftt_private.platform_organizers(user_id) values ('%s')" % users['organizer'][0])

    def rpc(who, fn, body=None):
        return request(api, anon, 'POST', '/rest/v1/rpc/' + fn,
                       token=users[who][2] if who else None, body=body or {})
    def ok(who, fn, body, label):
        r = rpc(who, fn, body)
        ensure(r.code == 200, label + ' HTTP ' + str(r.code))
        return r.body
    def no(who, fn, body, label):
        r = rpc(who, fn, body)
        ensure(r.code in (401, 403) and isinstance(r.body, dict) and r.body.get('code') in ('42501', 'PGRST301', 'PGRST302'),
               label + ' denied by authorization (HTTP ' + str(r.code) + ')')

    event = ok('organizer', 'fftt_create_event_v3', {'p_name':'Fictional signed delegation',
        'p_date':'2026-11-08', 'p_table_count':2}, 'create rehearsal')['event_id']
    other = ok('organizer', 'fftt_create_event_v3', {'p_name':'Fictional separate event',
        'p_date':'2026-11-22', 'p_table_count':2}, 'create separate event')['event_id']
    e = {'p_event_id':event}
    for label, role in (('manager','bracket_manager'),('score-a','scorekeeper'),
                        ('score-b','scorekeeper'),('revoked','scorekeeper')):
        ok('organizer','fftt_set_staff_v3',{**e,'p_email':users[label][1],
            'p_action':'grant','p_role':role},'grant fictional '+label)
    ok('organizer','fftt_set_staff_v3',{**e,'p_email':users['revoked'][1],
        'p_action':'revoke','p_role':None},'revoke fictional scorer')
    ok('organizer','fftt_upsert_players_v3',{**e,'p_players':[
        {'name':'Fictional Alpha Player','rating':3,'rating_status':'provisional'},
        {'name':'Fictional Bravo Player','rating':2,'rating_status':'provisional'},
        {'name':'Fictional Delta Player','rating':4,'rating_status':'provisional'}]},'add fictional players')
    before = ok('organizer','fftt_organizer_snapshot_v3',{'p_event_id':other},'separate snapshot')
    snapshot = ok('manager','fftt_bracket_manager_snapshot_v1',e,'manager sanitized snapshot')
    ensure(snapshot['staff'] == [] and all(p['registration_refs']==[] for p in snapshot['players'])
           and all(u[1] not in json.dumps(snapshot) for u in users.values()),'manager cannot see contacts or staff identities')
    for who in ('manager','score-a','score-b','outsider','revoked'):
        no(who,'fftt_organizer_snapshot_v3',e,who+' organizer snapshot')
        no(who,'fftt_registration_source_v5',e,who+' registration source')
        no(who,'fftt_set_visibility_v3',{**e,'p_visible':True},who+' publication')
        no(who,'fftt_set_staff_v3',{**e,'p_email':users['outsider'][1],
            'p_action':'grant','p_role':'organizer'},who+' staff administration')
        no(who,'fftt_export_event_v3',e,who+' private export')
        no(who,'fftt_matchdesk_v2',{'p_event_id':other},who+' wrong event')
    no('revoked','fftt_matchdesk_v2',e,'revoked token')
    no('outsider','fftt_bracket_manager_snapshot_v1',e,'outsider manager snapshot')
    for who in ('score-a','score-b','outsider','revoked'):
        no(who,'fftt_event_day_walkin_v1',{**e,'p_name':'Fictional Rejected Player','p_rating':2},who+' walk-in')
        no(who,'fftt_set_checkin_v3',{**e,'p_player_id':snapshot['players'][0]['id'], 'p_checked_in':True},who+' check-in')
        no(who,'fftt_set_lifecycle_v3',{**e,'p_lifecycle':'complete'},who+' completion')
    for p in snapshot['players']:
        ok('manager','fftt_set_checkin_v3',{**e,'p_player_id':p['id'],'p_checked_in':True},'manager check-in')
    ok('manager','fftt_event_day_walkin_v1',{**e,'p_name':'Fictional Charlie Walkin','p_rating':1},'manager walk-in')
    snapshot=ok('manager','fftt_bracket_manager_snapshot_v1',e,'manager roster')
    ids=[p['id'] for p in snapshot['players']]
    ok('manager','fftt_build_championship_v3',{**e,'p_slots':ids,'p_expected_generation':0,'p_confirm':False},'manager builds bracket')
    desk=ok('score-a','fftt_matchdesk_v2',e,'scorekeeper match desk')
    first=desk[0]
    for who in ('score-a','score-b','outsider','revoked'):
        no(who,'fftt_set_match_format_v4',{**e,'p_match_id':first['match_id'],'p_best_of':1,'p_points':21},who+' format')
        no(who,'fftt_forfeit_match_v3',{**e,'p_match_id':first['match_id'],'p_expected_match_version':first['match_version'],
           'p_absent_player_id':first['player_2_id'],'p_reason':'Fictional no show'},who+' forfeit')
        no(who,'fftt_correct_result_v3',{**e,'p_match_id':first['match_id'],'p_expected_match_version':first['match_version'],
           'p_winner_id':first['player_1_id'],'p_game_scores':'21-0','p_reason':'Fictional scorecard'},who+' correction')
    ok('manager','fftt_set_match_format_v4',{**e,'p_match_id':first['match_id'],'p_best_of':1,'p_points':21},'manager changes format')
    ok('manager','fftt_forfeit_match_v3',{**e,'p_match_id':first['match_id'],'p_expected_match_version':first['match_version'],
       'p_absent_player_id':first['player_2_id'],'p_reason':'Fictional no show'},'manager forfeit')
    snap=ok('manager','fftt_bracket_manager_snapshot_v1',e,'manager result snapshot')
    done=next(m for m in snap['matches'] if m['id']==first['match_id'])
    ok('manager','fftt_correct_result_v3',{**e,'p_match_id':done['id'],'p_expected_match_version':done['version'],
       'p_winner_id':done['winner_id'],'p_game_scores':'21-0','p_reason':'Fictional scorecard'},'manager correction')
    used=[]
    for i in range(8):
        who=('score-a','score-b')[i%2]
        pending=ok(who,'fftt_matchdesk_v2',e,who+' reads match desk')
        if not pending: break
        m=pending[0]
        scores=','.join([str(m['points_to_win'])+'-0']*((m['best_of']+1)//2))
        out=ok(who,'fftt_submit_match_result_v2',{**e,'p_match_id':m['match_id'],
          'p_bracket_generation':m['bracket_generation'],'p_expected_match_version':m['match_version'],
          'p_submission_id':str(uuid.uuid4()),'p_winner_id':m['player_1_id'],'p_game_scores':scores,'p_table_number':1},who+' submits score')
        ensure(out['status']=='accepted',who+' score accepted'); used.append(who)
    ensure(set(used)=={'score-a','score-b'},'both independent scorers submitted results')
    result=ok('manager','fftt_set_lifecycle_v3',{**e,'p_lifecycle':'complete'},'manager completes tournament')
    ensure(result['lifecycle']=='complete','finished event completed')
    audit=ok('organizer','fftt_audit_log_v3',{**e,'p_limit':100},'organizer audit')
    ensure(all(any(x['operation']==op for x in audit) for op in ('registration_checkin','match_forfeited','result_corrected','format_changed','lifecycle_changed')),'delegation changes are audited')
    ensure(before == ok('organizer','fftt_organizer_snapshot_v3',{'p_event_id':other},'separate event after test'),'separate event unchanged')
    print('PASS: independently authenticated LOCAL delegation role matrix')


if __name__ == '__main__':
    run()
