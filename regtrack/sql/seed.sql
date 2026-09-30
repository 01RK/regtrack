-- =====================================================================
-- RegTrack 具身智能行业模拟数据 v7
--
-- 本文件中的人物、组织、标准编号、时间线、试验结果及业务描述均为虚构，
-- 仅用于演示法规/标准跟踪功能。引用均使用 example.invalid 保留域名。
-- 覆盖机器人安全、具身智能系统、操作臂性能、网络安全与数据治理等主题。
-- =====================================================================

INSERT INTO lookup_value (category,value,note,sort_order) VALUES
('impact_area','Robot Safety','机器人整机与功能安全',10),
('impact_area','Embodied AI','感知、决策与自主作业',20),
('impact_area','Manipulation','操作臂与末端执行器',30),
('impact_area','Robot Cybersecurity','本体、边缘端与云端安全',40),
('impact_area','Data Governance','数据采集、标注与留存',50),
('impact_area','Motion Control','移动底盘与全身控制',60),
('impact_area','Testing','实验室与现场验证',70),
('impact_area','Human-Robot Interaction','人机协作与接触安全',80),
('person','陈一鸣','机器人标准与测试负责人',10),
('person','林知远','具身智能系统工程师',20),
('person','许清禾','安全评测与认证工程师',30),
('person','顾星野','操作规划与控制工程师',40),
('person','沈可欣','机器人测试工程师',50),
('person','唐予安','网络安全工程师',60),
('person','叶知秋','标准跟踪协调员',70),
('person','苏念','数据治理工程师',80),
('person','周启明','机器人系统集成工程师',90),
('team','机器人标准与测试部','法规跟踪、试验设计与标准化',10),
('team','具身智能系统部','感知、规划、决策与端侧模型',20),
('team','机器人本体研发部','结构、执行器、传感器与整机集成',30),
('team','安全评测与认证部','风险评估、认证资料与安全验证',40),
('team','机器人测试与验证中心','实验室、仿真与现场测试',50),
('team','网络安全与数据治理部','网络安全、数据质量与隐私治理',60),
('team','操作与运动控制部','操作臂、末端执行器与移动控制',70),
('team','供应链与质量部','关键部件、供应商与质量管理',80),
('organization','全国机器人标准化技术委员会（虚构）','机器人安全与测试标准归口',10),
('organization','具身智能标准工作组（虚构）','具身智能系统标准起草组',20),
('organization','机器人安全评测中心（虚构）','第三方检测与认证机构',30),
('organization','机器人数据治理联盟（虚构）','机器人数据规范工作组',40),
('tc_wg','TC/RB 01 机器人安全分委会','整机与功能安全',10),
('tc_wg','TC/RB 02 具身智能系统分委会','感知、决策与模型部署',20),
('tc_wg','TC/RB 03 操作与运动控制分委会','操作臂与移动平台',30),
('tc_wg','TC/RB 04 数据与网络安全分委会','数据治理与网络安全',40);

INSERT INTO standard
(id,std_no,name_cn,name_en,stage_code,std_type,tc_wg,responsible_authority,
 leading_org,risk_level,mb_owner,planned_release_date,actual_release_date,
 effective_date,scope,created_at,created_by,updated_at,updated_by) VALUES
(1,'GB/T 4R001—2026','具身智能机器人整机安全要求','Safety requirements for embodied AI robots','REVIEW_DRAFT','GB/T','TC/RB 01 机器人安全分委会','全国机器人标准化技术委员会（虚构）','机器人安全评测中心（虚构）','High','许清禾','2027-06-30',NULL,NULL,'规定移动操作机器人在实验室与预期工作区域内的稳定性、急停、速度限制、碰撞防护和故障响应要求。示例场景包括货架取放、工具递送与人机协作。','2025-02-03 09:00:00','叶知秋','2026-06-12 14:00:00','许清禾'),
(2,'2026R017-Q-XYZ','具身智能系统感知与任务执行能力评价方法','Evaluation methods for perception and task execution of embodied AI systems','COMMENT_DRAFT','GB','TC/RB 02 具身智能系统分委会','具身智能产业主管部门（虚构）','具身智能标准工作组（虚构）','High','林知远','2027-12-31',NULL,NULL,'建立开放词汇物体识别、空间定位、指令理解、抓取成功率、任务完成率和失败恢复能力的评价流程，要求记录环境配置、模型版本与随机种子。','2026-01-12 10:00:00','叶知秋','2026-08-18 16:30:00','林知远'),
(3,'2025R009-T-XYZ','机器人操作臂重复定位与负载性能测试规程','Test code for repeatability and payload performance of robot manipulators','PROJECT_APPROVAL','团体标准','TC/RB 03 操作与运动控制分委会','具身智能标准工作组（虚构）','机器人测试与验证中心（虚构）','Medium','顾星野','2027-09-30',NULL,NULL,'规定不同负载、速度和工作空间位置下的重复定位精度、末端抖动、温升与连续作业能力测试方法，适用于单臂及双臂操作机器人。','2025-11-03 09:30:00','叶知秋','2026-03-02 11:00:00','顾星野'),
(4,'GB/T 4R004—2025','服务机器人网络安全与软件更新要求','Cybersecurity and software update requirements for service robots','IMPLEMENTED','GB/T','TC/RB 04 数据与网络安全分委会','全国机器人标准化技术委员会（虚构）','机器人安全评测中心（虚构）','High','唐予安','2025-03-31','2025-04-18','2026-01-01','规定身份认证、通信保护、漏洞处置、软件更新签名校验、失败恢复和版本追溯要求，覆盖机器人本体、边缘计算单元与云端管理服务。','2024-05-06 09:00:00','叶知秋','2026-01-09 10:00:00','唐予安'),
(5,'2026R022-T-XYZ','机器人训练与测试数据质量及治理指南','Guidelines for quality and governance of robot training and test data','DRAFTING','团体标准','TC/RB 04 数据与网络安全分委会','机器人数据治理联盟（虚构）','具身智能标准工作组（虚构）','Medium','苏念','2028-03-31',NULL,NULL,'面向视觉、深度、力觉、语音与遥操作数据，给出采集授权、场景覆盖、标注一致性、脱敏、数据集版本和测试集隔离建议。','2026-04-07 09:00:00','叶知秋','2026-08-05 15:00:00','苏念');

INSERT INTO standard_impact_area (standard_id,impact_area) VALUES
(1,'Robot Safety'),(1,'Motion Control'),(1,'Human-Robot Interaction'),(1,'Testing'),
(2,'Embodied AI'),(2,'Testing'),(2,'Manipulation'),
(3,'Manipulation'),(3,'Motion Control'),(3,'Testing'),
(4,'Robot Cybersecurity'),(4,'Robot Safety'),
(5,'Data Governance'),(5,'Embodied AI'),(5,'Robot Cybersecurity');

INSERT INTO standard_stage_history
(standard_id,stage_code,record_type,effective_date,note,reference,created_at,created_by) VALUES
(1,'PROJECT_APPROVAL','ADVANCE','2025-02-03','虚构立项：明确整机安全范围与典型协作场景。','https://example.invalid/robot-standards/R001/plan','2025-02-03 09:10:00','叶知秋'),
(1,'DRAFTING','ADVANCE','2025-04-15','起草组完成风险分类，纳入移动、抓取和人机接触场景。','https://example.invalid/robot-standards/R001/outline','2025-04-16 10:00:00','许清禾'),
(1,'COMMENT_DRAFT','ADVANCE','2025-11-20','公开征求意见，重点征求协作速度与接触力限值建议。','https://example.invalid/robot-standards/R001/comment-draft','2025-11-21 09:30:00','许清禾'),
(1,'REVIEW_DRAFT','ADVANCE','2026-06-10','形成送审稿，补充急停距离和单点故障测试。','https://example.invalid/robot-standards/R001/review-draft','2026-06-12 13:50:00','许清禾'),
(2,'PROJECT_APPROVAL','ADVANCE','2026-01-12','立项通过，评价对象覆盖感知、指令理解与任务执行。',NULL,'2026-01-12 10:10:00','叶知秋'),
(2,'DRAFTING','ADVANCE','2026-03-18','起草组确定基准任务集、场景标签和失败分类。',NULL,'2026-03-19 09:00:00','林知远'),
(2,'COMMENT_DRAFT','ADVANCE','2026-08-15','发布征求意见稿，征求不同本体与仿真平台的复现意见。','https://example.invalid/robot-standards/R017/comment-draft','2026-08-18 16:20:00','林知远'),
(3,'PROJECT_APPROVAL','ADVANCE','2025-11-03','团体标准立项，优先统一重复定位和额定负载测试条件。',NULL,'2025-11-03 09:40:00','叶知秋'),
(4,'PROJECT_APPROVAL','ADVANCE','2023-10-10','立项：建立机器人全生命周期网络安全基线。',NULL,'2024-05-06 09:10:00','叶知秋'),
(4,'DRAFTING','ADVANCE','2024-02-01','形成身份认证、更新签名和漏洞处置章节。',NULL,'2024-05-06 09:20:00','唐予安'),
(4,'COMMENT_DRAFT','ADVANCE','2024-07-15','公开征求意见。','https://example.invalid/robot-standards/R004/comment-draft','2024-07-16 10:00:00','唐予安'),
(4,'REVIEW_DRAFT','ADVANCE','2024-10-21','送审稿补入更新失败恢复与边缘端证书轮换要求。',NULL,'2024-10-22 09:00:00','唐予安'),
(4,'APPROVAL_DRAFT','ADVANCE','2025-01-20','报批稿完成，实施日期设置 12 个月准备期。',NULL,'2025-01-21 11:00:00','唐予安'),
(4,'RELEASED','ADVANCE','2025-04-18','标准发布，编号 GB/T 4R004—2025。',NULL,'2025-04-21 09:00:00','唐予安'),
(4,'IMPLEMENTED','ADVANCE','2026-01-01','正式实施，纳入新版本发布与漏洞响应流程。',NULL,'2026-01-09 09:30:00','唐予安'),
(5,'PROJECT_APPROVAL','ADVANCE','2026-04-07','立项：明确训练数据与独立测试数据的治理边界。',NULL,'2026-04-07 09:10:00','叶知秋'),
(5,'DRAFTING','ADVANCE','2026-06-02','起草组形成数据质量维度和标注抽检框架。',NULL,'2026-06-03 10:00:00','苏念');
UPDATE standard_stage_history SET updated_at = created_at, updated_by = NULL;

INSERT INTO draft
(id,standard_id,version_name,sub_version_no,draft_date,file_link,issued_by,main_summary,overall_impact,notes,created_at,created_by,updated_at,updated_by) VALUES
(1,1,'讨论稿','1.0','2025-06-20','https://example.invalid/robot-standards/R001/discussion-v1','具身智能标准工作组（虚构）','初稿提出稳定性、急停和速度限制要求，接触力评价方法尚未统一。','High','虚构讨论稿。','2025-06-23 09:00:00','许清禾','2025-06-23 09:00:00','许清禾'),
(2,1,'征求意见稿','1.0','2025-11-20','https://example.invalid/robot-standards/R001/comment-v1','全国机器人标准化技术委员会（虚构）','新增人机协作区速度分级与碰撞后恢复要求，征求意见截止 2026-01-19。','High','虚构征求意见稿。','2025-11-21 09:20:00','许清禾','2025-11-21 09:20:00','许清禾'),
(3,1,'送审稿','1.0','2026-06-10','https://example.invalid/robot-standards/R001/review-v1','全国机器人标准化技术委员会（虚构）','吸收急停距离与单点故障测试意见，明确速度测量和停止状态判定。','High','虚构送审稿。','2026-06-12 13:40:00','许清禾','2026-06-12 13:40:00','许清禾'),
(4,2,'讨论稿','1.0','2026-05-30','https://example.invalid/robot-standards/R017/discussion-v1','具身智能标准工作组（虚构）','定义任务成功、部分成功、失败恢复与人工接管指标。','High','虚构讨论稿。','2026-06-02 10:00:00','林知远','2026-06-02 10:00:00','林知远'),
(5,2,'征求意见稿','1.0','2026-08-15','https://example.invalid/robot-standards/R017/comment-v1','具身智能标准工作组（虚构）','增加跨房间导航、杂乱场景抓取和长时序任务基准。','High','虚构征求意见稿。','2026-08-18 16:10:00','林知远','2026-08-18 16:10:00','林知远'),
(6,4,'征求意见稿','1.0','2024-07-15','https://example.invalid/robot-standards/R004/comment-v1','全国机器人标准化技术委员会（虚构）','提出设备身份、更新签名、漏洞通告与支持周期要求。','High','虚构征求意见稿。','2024-07-16 09:30:00','唐予安','2024-07-16 09:30:00','唐予安'),
(7,4,'发布稿','1.0','2025-04-18','https://example.invalid/robot-standards/R004/release-v1','全国机器人标准化技术委员会（虚构）','发布稿明确更新失败恢复和漏洞响应流程。','Medium','虚构发布稿。','2025-04-21 09:10:00','唐予安','2025-04-21 09:10:00','唐予安');

INSERT INTO clause_evolution
(id,draft_id,last_draft_id,current_clause_no,last_clause_no,topic,last_clause_text,current_clause_text,change_type,change_desc,interpretation,test_impact,homologation_impact,compliance_risk,responsible_person,created_at,created_by,updated_at,updated_by) VALUES
(1,2,1,'6.2','6.2','人机协作速度','协作区域内速度应保持较低水平。','协作区域速度应按风险等级设定，并记录测量位置、负载和控制模式。','修改 Modify','将笼统的低速要求改为可复现的分级测试条件。','需在空载与额定负载下分别验证速度监测误差。','Yes','High','High','沈可欣','2025-11-21 10:00:00','许清禾','2025-11-21 10:00:00','许清禾'),
(2,3,2,'7.4','7.4','急停距离','急停后机器人应停止运动。','急停距离应在规定速度、负载和地面条件下测量，并报告最大值。','澄清 Clarification','补充急停距离的测量条件和报告要求。','急停距离数据将进入安全验证报告。','Yes','High','Medium','沈可欣','2026-06-12 14:10:00','许清禾','2026-06-12 14:10:00','许清禾'),
(3,5,4,'附录B','附录A','测试集隔离','未规定训练数据与测试数据的隔离方式。','基准测试集应按场景与任务分层留存，训练阶段不得访问测试标签。','新增 Add','增加独立测试集管理要求，降低数据泄漏导致的评测偏差。','需要完善数据权限和版本记录。','Yes','Medium','High','苏念','2026-08-18 16:25:00','林知远','2026-08-18 16:25:00','林知远'),
(4,7,6,'8.3','8.3','更新失败恢复','软件更新失败后应恢复到可用版本。','更新失败后应自动恢复已验证版本，并记录恢复结果与设备状态。','修改 Modify','明确自动恢复和审计记录要求。','需加入断电与网络中断场景测试。','Yes','High','High','唐予安','2025-04-21 09:20:00','唐予安','2025-04-21 09:20:00','唐予安');

INSERT INTO meeting
(id,meeting_no,title,meeting_date,meeting_type,organizer,participants,key_discussions,overall_conclusion,material_link,next_meeting_date,created_at,created_by,updated_at,updated_by) VALUES
(1,'MTG-2026-001','具身智能机器人整机安全送审稿审查会','2026-06-10','WG 全体会','全国机器人标准化技术委员会（虚构）','安全评测、整机研发与测试机构代表（均为虚构）','讨论急停距离测量、协作速度分级及夹持场景风险。','同意补充速度测量负载条件与单点故障测试。','https://example.invalid/meetings/MTG-2026-001','2026-10-08','2026-06-12 13:00:00','许清禾','2026-06-12 13:00:00','许清禾'),
(2,'MTG-2026-002','具身智能任务基准与测试集隔离专题会','2026-08-12','专题组会','具身智能标准工作组（虚构）','算法、数据治理和评测人员（均为虚构）','讨论场景分层、任务成功判定、人工接管和测试集污染风险。','先发布基准任务清单，测试集由独立管理角色维护。','https://example.invalid/meetings/MTG-2026-002',NULL,'2026-08-13 09:00:00','林知远','2026-08-13 09:00:00','林知远'),
(3,'MTG-2026-003','机器人标准月度跟踪会（8 月）','2026-08-18','内部例会','机器人标准与测试部','标准、系统研发、网络安全和测试接口人（均为虚构）','逐项确认整机安全送审、任务基准征求意见和数据治理起草进展。','两项意见征集任务在截止日前完成跨团队反馈。','https://example.invalid/meetings/MTG-2026-003',NULL,'2026-08-18 10:00:00','叶知秋','2026-08-18 10:00:00','叶知秋');

INSERT INTO meeting_standard (meeting_id,standard_id,note) VALUES
(1,1,'审查急停和协作速度条款'),(2,2,'讨论任务成功率与测试集隔离'),
(2,5,'同步讨论数据集版本和标注抽检'),(3,1,'确认送审稿后续意见跟踪'),
(3,2,'确认跨团队征求意见分工'),(3,5,'确认数据治理草案试点范围');

INSERT INTO action_item
(id,item_no,item_type,standard_id,meeting_id,draft_id,title,description,related_clause,priority,current_status,final_summary,supporting_ref,requesting_body,submission_due_date,submission_channel,drafter_counterpart,target_position,actual_lobby_time,lobby_method,outcome,check_owner,check_due_date,actual_check_time,check_result,gap_description,coordinator,target_date,created_at,created_by,updated_at,updated_by) VALUES
(1,'AI-2026-001','Collect Comments',1,1,3,'征集整机安全送审稿内部意见','请安全评测、整机研发与机器人测试团队评估急停距离、速度测量条件和夹持风险，提交书面意见。','6.2、7.4','High','In Progress',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-06-13 09:00:00','许清禾','2026-08-18 10:30:00','叶知秋'),
(2,'AI-2026-002','Survey Feedback',2,2,5,'提交具身智能基准任务试测反馈','使用虚构任务集完成导航、物体识别、抓取与失败恢复试测，记录模型版本、场景配置和人工接管次数。','附录A、附录B','High','Waiting for Response',NULL,NULL,'具身智能标准工作组（虚构）','2026-09-15','系统平台',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-08-13 09:30:00','林知远','2026-08-18 16:00:00','林知远'),
(3,'AI-2026-003','Compliance Check',4,NULL,7,'复核机器人软件更新流程','抽查本季度机器人软件发布记录，确认签名校验、更新失败恢复和漏洞响应留痕。','8.3、9.1','Medium','Ready for Review',NULL,'https://example.invalid/evidence/update-review-2026-Q3',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'唐予安','2026-09-30','2026-08-20','Partial','断电恢复场景记录尚未完整，需补充两种本体配置的验证证据。',NULL,NULL,'2026-07-15 09:00:00','唐予安','2026-08-20 16:00:00','唐予安'),
(4,'AI-2026-004','Others',5,3,NULL,'建立数据集版本登记流程','为训练集、开发集和独立测试集建立版本登记、访问角色与变更记录，先选取两个虚构任务集试运行。',NULL,'Medium','In Progress',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'苏念','2026-10-15','2026-08-18 11:00:00','苏念','2026-08-20 10:00:00','苏念');

INSERT INTO feedback_recipient
(id,action_item_id,respondent_team,respondent_person,response_status,response_due_date,response_actual_date,response_summary,created_at,created_by) VALUES
(1,1,'机器人本体研发部','陈一鸣','Responded','2026-08-20','2026-08-17','建议在移动底盘最大负载和末端工具偏置两种条件下分别记录急停距离。','2026-06-13 09:10:00','许清禾'),
(2,1,'机器人测试与验证中心','沈可欣','Open','2026-08-20',NULL,NULL,'2026-06-13 09:12:00','许清禾'),
(3,1,'安全评测与认证部','许清禾','Open','2026-08-20',NULL,NULL,'2026-06-13 09:14:00','许清禾'),
(4,2,'具身智能系统部','林知远','Responded','2026-09-15','2026-08-18','试测发现遮挡条件下抓取失败恢复指标差异较大，建议将遮挡比例作为场景标签。','2026-08-13 09:40:00','林知远'),
(5,2,'机器人测试与验证中心','沈可欣','Open','2026-09-15',NULL,NULL,'2026-08-13 09:42:00','林知远');

INSERT INTO comment
(id,comment_no,standard_id,draft_id,clause_no,topic,comment_text,rationale,status,submitted_by,submission_channel,submission_date,response,follow_up,source_recipient_id,created_at,created_by,updated_at,updated_by) VALUES
(1,'CM-2026-001',1,2,'6.2','协作速度测量条件','建议明确速度测量应覆盖额定负载、末端工具偏置和接触前减速过程。','不同负载下控制器限速表现不同，仅报告空载速度无法代表实际协作风险。','Accepted','沈可欣','系统平台','2026-01-15','采纳。送审稿新增负载和测量位置记录要求。','在送审稿 6.2 条核对落实情况。',1,'2026-01-14 09:00:00','沈可欣','2026-06-12 14:20:00','许清禾'),
(2,'CM-2026-002',2,5,'附录B','测试集场景分层','建议按光照、遮挡、物体材质和背景复杂度分层报告任务完成率。','单一汇总值会掩盖模型在长尾场景中的性能差异。','Submitted','林知远','会议','2026-08-18',NULL,'等待工作组汇总，补充跨本体复现结果。',4,'2026-08-18 15:00:00','林知远','2026-08-18 16:10:00','林知远'),
(3,'CM-2026-003',5, NULL,'4.3','测试数据版本追踪','建议每个测试结果记录数据集版本、标注版本和排除样本原因。','数据迭代会改变任务难度，缺少版本信息时无法复现比较。','Draft','苏念',NULL,NULL,NULL,'与数据治理工作组确认字段模板后提交。',NULL,'2026-08-19 09:00:00','苏念','2026-08-19 09:00:00','苏念');

INSERT INTO comment_status_history
(comment_id,previous_value,new_value,effective_date,note,reference,recorded_at,recorded_by) VALUES
(1,NULL,'Draft','2026-01-14','汇总本体研发和测试团队意见。',NULL,'2026-01-14 09:05:00','沈可欣'),
(1,'Draft','Submitted','2026-01-15','通过系统平台提交。',NULL,'2026-01-15 10:00:00','沈可欣'),
(1,'Submitted','Accepted','2026-06-10','送审稿补充负载与测量位置要求。','https://example.invalid/robot-standards/R001/review-v1','2026-06-12 14:25:00','许清禾'),
(2,NULL,'Draft','2026-08-18','根据首次基准试测整理意见。',NULL,'2026-08-18 15:05:00','林知远'),
(2,'Draft','Submitted','2026-08-18','专题会上形成书面意见并提交。',NULL,'2026-08-18 16:00:00','林知远'),
(3,NULL,'Draft','2026-08-19','先整理版本追踪建议，待确认数据字段。',NULL,'2026-08-19 09:05:00','苏念');

INSERT INTO action_status_history
(action_item_id,previous_value,new_value,effective_date,note,reference,recorded_at,recorded_by) VALUES
(1,NULL,'Open','2026-06-13','征集送审稿内部意见。',NULL,'2026-06-13 09:05:00','许清禾'),
(1,'Open','In Progress','2026-08-17','已收到本体研发部反馈，测试中心与评测团队待回复。',NULL,'2026-08-18 10:35:00','叶知秋'),
(2,NULL,'Open','2026-08-13','工作组邀请成员单位开展基准试测。',NULL,'2026-08-13 09:35:00','林知远'),
(2,'Open','Waiting for Response','2026-08-18','已收到系统组初步结果，等待测试中心复测。',NULL,'2026-08-18 16:05:00','林知远'),
(3,NULL,'Open','2026-07-15','启动更新流程符合性抽查。',NULL,'2026-07-15 09:05:00','唐予安'),
(3,'Open','In Progress','2026-07-20','开始检查签名校验、失败恢复和漏洞响应记录。',NULL,'2026-07-20 09:00:00','唐予安'),
(3,'In Progress','Ready for Review','2026-08-20','完成首轮核查，断电恢复证据待补。',NULL,'2026-08-20 16:05:00','唐予安'),
(4,NULL,'Open','2026-08-18','例会上确定先试运行数据集版本登记。',NULL,'2026-08-18 11:05:00','苏念'),
(4,'Open','In Progress','2026-08-20','已起草登记字段和角色权限表。',NULL,'2026-08-20 10:05:00','苏念');

INSERT INTO recipient_status_history
(feedback_recipient_id,previous_value,new_value,effective_date,note,reference,recorded_at,recorded_by) VALUES
(1,NULL,'Open','2026-06-13','已发送内部征求意见。',NULL,'2026-06-13 09:15:00','许清禾'),
(1,'Open','Responded','2026-08-17','本体研发团队提交负载与工具偏置建议。',NULL,'2026-08-17 16:00:00','陈一鸣'),
(2,NULL,'Open','2026-06-13','已发送内部征求意见。',NULL,'2026-06-13 09:16:00','许清禾'),
(3,NULL,'Open','2026-06-13','已发送内部征求意见。',NULL,'2026-06-13 09:17:00','许清禾'),
(4,NULL,'Open','2026-08-13','已邀请参加基准试测。',NULL,'2026-08-13 09:45:00','林知远'),
(4,'Open','Responded','2026-08-18','反馈遮挡场景应单独标注。',NULL,'2026-08-18 15:50:00','林知远'),
(5,NULL,'Open','2026-08-13','已邀请参加基准复测。',NULL,'2026-08-13 09:46:00','林知远');
