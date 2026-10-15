export const DEFAULT_ACCENT = "#3b82f6";

function ProfileCard({ profile, onLaunch, onEdit }) {
  return (
    <div
      className="profile-card"
      style={{ "--accent": profile.accent ?? DEFAULT_ACCENT }}
      role="button"
      tabIndex={0}
      title={`Launch ${profile.name}`}
      onClick={() => onLaunch(profile.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onLaunch(profile.id);
      }}
    >
      <div className="profile-card__name">{profile.name}</div>
      <div className="profile-card__meta" title={profile.cwd}>
        {profile.cwd}
      </div>
      <div className="profile-card__meta">{profile.model || "default model"}</div>
      <button
        type="button"
        className="profile-card__edit"
        aria-label={`Edit ${profile.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onEdit(profile);
        }}
      >
        …
      </button>
    </div>
  );
}

export default function ProfilesRail({ profiles, onLaunch, onEdit, onNew }) {
  return (
    <nav className="profiles-rail" aria-label="Launch profiles">
      {profiles.map((profile) => (
        <ProfileCard key={profile.id} profile={profile} onLaunch={onLaunch} onEdit={onEdit} />
      ))}
      <button type="button" className="profile-card profile-card--new" onClick={onNew}>
        <span>New Profile</span>
        <span className="profile-card__plus">+</span>
      </button>
    </nav>
  );
}
