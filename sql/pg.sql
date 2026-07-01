
-- ----------------------------
-- Table structure for note_category
-- ----------------------------
DROP TABLE IF EXISTS public.note_category;
CREATE TABLE public.note_category (
    id bigint NOT NULL DEFAULT nextval('note_category_id_seq'::regclass),
    user_id bigint NOT NULL,
    name varchar(100) NOT NULL,
    sort integer DEFAULT 0,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_note_category PRIMARY KEY (id),
    CONSTRAINT uk_note_category_user_name UNIQUE (user_id, name, is_deleted)
);
CREATE INDEX idx_note_category_is_deleted ON public.note_category(is_deleted);
ALTER TABLE public.note_category ADD CONSTRAINT fk_category_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for note_category_rel
-- ----------------------------
DROP TABLE IF EXISTS public.note_category_rel;
CREATE TABLE public.note_category_rel (
    note_id bigint NOT NULL,
    category_id bigint NOT NULL,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_note_category_rel PRIMARY KEY (note_id, category_id, is_deleted)
);
CREATE INDEX idx_note_category_rel_category_id ON public.note_category_rel(category_id);
CREATE INDEX idx_note_category_rel_is_deleted ON public.note_category_rel(is_deleted);
ALTER TABLE public.note_category_rel ADD CONSTRAINT fk_rel_category FOREIGN KEY (category_id) REFERENCES public.note_category(id) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE public.note_category_rel ADD CONSTRAINT fk_rel_note FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for note_history
-- ----------------------------
DROP TABLE IF EXISTS public.note_history;
CREATE TABLE public.note_history (
    id bigint NOT NULL DEFAULT nextval('note_history_id_seq'::regclass),
    note_id bigint NOT NULL,
    title varchar(500),
    content text,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    user_id bigint NOT NULL,
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_note_history PRIMARY KEY (id)
);
CREATE INDEX idx_note_history_user_id ON public.note_history(user_id);
CREATE INDEX idx_note_history_is_deleted ON public.note_history(is_deleted);
CREATE INDEX idx_note_history_note_id ON public.note_history(note_id);
ALTER TABLE public.note_history ADD CONSTRAINT fk_history_note FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE public.note_history ADD CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for note_share
-- ----------------------------
DROP TABLE IF EXISTS public.note_share;
CREATE TABLE public.note_share (
    id bigint NOT NULL DEFAULT nextval('note_share_id_seq'::regclass),
    note_id bigint NOT NULL,
    share_code varchar(64) NOT NULL,
    access_password varchar(64),
    permission varchar(16) NOT NULL DEFAULT 'read',
    activate_expire timestamptz(6),
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_note_share PRIMARY KEY (id),
    CONSTRAINT uk_note_share_code UNIQUE (share_code)
);
CREATE INDEX idx_note_share_note_id ON public.note_share(note_id);
CREATE INDEX idx_note_share_is_deleted ON public.note_share(is_deleted);
ALTER TABLE public.note_share ADD CONSTRAINT fk_share_note FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for note_tag
-- ----------------------------
DROP TABLE IF EXISTS public.note_tag;
CREATE TABLE public.note_tag (
    id bigint NOT NULL DEFAULT nextval('note_tag_id_seq'::regclass),
    user_id bigint NOT NULL,
    name varchar(64) NOT NULL,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_note_tag PRIMARY KEY (id),
    CONSTRAINT uk_note_tag_user_name UNIQUE (user_id, name, is_deleted)
);
CREATE INDEX idx_note_tag_is_deleted ON public.note_tag(is_deleted);
ALTER TABLE public.note_tag ADD CONSTRAINT fk_tag_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for note_tag_rel
-- ----------------------------
DROP TABLE IF EXISTS public.note_tag_rel;
CREATE TABLE public.note_tag_rel (
    note_id bigint NOT NULL,
    tag_id bigint NOT NULL,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_note_tag_rel PRIMARY KEY (note_id, tag_id, is_deleted)
);
CREATE INDEX idx_note_tag_rel_tag_id ON public.note_tag_rel(tag_id);
CREATE INDEX idx_note_tag_rel_is_deleted ON public.note_tag_rel(is_deleted);
ALTER TABLE public.note_tag_rel ADD CONSTRAINT fk_tagrel_note FOREIGN KEY (note_id) REFERENCES public.notes(id) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE public.note_tag_rel ADD CONSTRAINT fk_tagrel_tag FOREIGN KEY (tag_id) REFERENCES public.note_tag(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for notes
-- ----------------------------
DROP TABLE IF EXISTS public.notes;
CREATE TABLE public.notes (
    id bigint NOT NULL DEFAULT nextval('notes_id_seq'::regclass),
    user_id bigint NOT NULL,
    title varchar(500) NOT NULL DEFAULT '无标题',
    content text,
    is_draft smallint NOT NULL DEFAULT 0,
    is_top smallint NOT NULL DEFAULT 0,
    is_star smallint NOT NULL DEFAULT 0,
    is_deleted smallint NOT NULL DEFAULT 0,
    delete_expire timestamptz(6),
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    note_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED,
    is_encrypted smallint NOT NULL DEFAULT 0,
    password_hash text,
    salt text,
    iv text,
    deleted_at timestamptz(6),
    version integer NOT NULL DEFAULT 1,
    CONSTRAINT pk_notes PRIMARY KEY (id)
);
CREATE INDEX idx_notes_user_id ON public.notes(user_id);
CREATE INDEX idx_notes_is_deleted ON public.notes(is_deleted);
CREATE INDEX idx_note_search ON public.notes USING gin(note_tsv);
ALTER TABLE public.notes ADD CONSTRAINT fk_note_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for sys_config
-- ----------------------------
DROP TABLE IF EXISTS public.sys_config;
CREATE TABLE public.sys_config (
    id bigint NOT NULL DEFAULT nextval('sys_config_id_seq'::regclass),
    config_key varchar(100) NOT NULL,
    config_value varchar(5000) NOT NULL,
    config_desc varchar(255) NOT NULL DEFAULT '',
    config_type varchar(20) NOT NULL DEFAULT 'string',
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_sys_config PRIMARY KEY (id),
    CONSTRAINT uk_sys_config_key UNIQUE (config_key)
);
CREATE INDEX idx_sys_config_is_deleted ON public.sys_config(is_deleted);

-- ----------------------------
-- Table structure for user_email_activate
-- ----------------------------
DROP TABLE IF EXISTS public.user_email_activate;
CREATE TABLE public.user_email_activate (
    id bigint NOT NULL DEFAULT nextval('user_email_activate_id_seq'::regclass),
    user_id bigint NOT NULL,
    new_email varchar(100) NOT NULL,
    activate_token varchar(100) NOT NULL,
    activate_expire timestamptz(6) NOT NULL,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_user_email_activate PRIMARY KEY (id),
    CONSTRAINT uk_user_email_activate_token UNIQUE (activate_token),
    CONSTRAINT uk_user_email_activate_uid UNIQUE (user_id)
);
CREATE INDEX idx_user_email_activate_is_deleted ON public.user_email_activate(is_deleted);
ALTER TABLE public.user_email_activate ADD CONSTRAINT fk_email_activate_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for user_file
-- ----------------------------
DROP TABLE IF EXISTS public.user_file;
CREATE TABLE public.user_file (
    id bigint NOT NULL DEFAULT nextval('user_file_id_seq'::regclass),
    user_id bigint NOT NULL,
    storage_path text NOT NULL,
    file_name varchar(256),
    mime_type varchar(128),
    size bigint,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_user_file PRIMARY KEY (id)
);
CREATE INDEX idx_user_file_user_id ON public.user_file(user_id);
CREATE INDEX idx_user_file_is_deleted ON public.user_file(is_deleted);
ALTER TABLE public.user_file ADD CONSTRAINT fk_file_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for user_refresh_token
-- ----------------------------
DROP TABLE IF EXISTS public.user_refresh_token;
CREATE TABLE public.user_refresh_token (
    id bigint NOT NULL DEFAULT nextval('user_refresh_token_id_seq'::regclass),
    user_id bigint NOT NULL,
    refresh_token text NOT NULL,
    activate_expire timestamptz(6) NOT NULL,
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_user_refresh_token PRIMARY KEY (id)
);
CREATE INDEX idx_user_refresh_token_user_id ON public.user_refresh_token(user_id);
CREATE INDEX idx_user_refresh_token_is_deleted ON public.user_refresh_token(is_deleted);
ALTER TABLE public.user_refresh_token ADD CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for user_reset_token
-- ----------------------------
DROP TABLE IF EXISTS public.user_reset_token;
CREATE TABLE public.user_reset_token (
    id bigint NOT NULL DEFAULT nextval('user_reset_token_id_seq'::regclass),
    user_id bigint NOT NULL,
    reset_token varchar(255) NOT NULL,
    activate_expire timestamp(6) NOT NULL,
    created_at timestamp(6) NOT NULL DEFAULT now(),
    updated_at timestamp(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_user_reset_token PRIMARY KEY (id),
    CONSTRAINT uk_user_reset_token UNIQUE (reset_token)
);
CREATE INDEX idx_user_reset_token_user_id ON public.user_reset_token(user_id);
CREATE INDEX idx_user_reset_token_is_deleted ON public.user_reset_token(is_deleted);
ALTER TABLE public.user_reset_token ADD CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ----------------------------
-- Table structure for users
-- ----------------------------
DROP TABLE IF EXISTS public.users;
CREATE TABLE public.users (
    id bigint NOT NULL DEFAULT nextval('users_id_seq'::regclass),
    username varchar(64) NOT NULL,
    email varchar(128),
    password_hash varchar(128) NOT NULL,
    avatar varchar(300),
    created_at timestamptz(6) NOT NULL DEFAULT now(),
    updated_at timestamptz(6) NOT NULL DEFAULT now(),
    is_deleted smallint NOT NULL DEFAULT 0,
    status varchar(20) NOT NULL DEFAULT 'inactive',
    activate_token varchar(100),
    activate_expire timestamp(6),
    role varchar(20) NOT NULL DEFAULT 'user',
    is_frozen smallint NOT NULL DEFAULT 0,
    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uk_users_username UNIQUE (username),
    CONSTRAINT uk_users_email UNIQUE (email)
);
CREATE INDEX idx_users_is_deleted ON public.users(is_deleted);


-- 给笔记-分类中间表新增更新时间字段
ALTER TABLE note_category_rel ADD COLUMN updated_at timestamptz(6) NOT NULL DEFAULT now();
COMMENT ON COLUMN note_category_rel.updated_at IS '记录最后更新UTC时间';

-- 给笔记-标签中间表新增更新时间字段
ALTER TABLE note_tag_rel ADD COLUMN updated_at timestamptz(6) NOT NULL DEFAULT now();
COMMENT ON COLUMN note_tag_rel.updated_at IS '记录最后更新UTC时间';