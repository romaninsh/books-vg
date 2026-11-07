# Deploy identity, secret and the public Cloud Run service for books-vg ("Books. Sorted.", the
# bookkeeping web app, api/books.yaml) in the golf production project. Same shape as sap-vg's module.
# A module of vantage-terraform (`module "books_vg_gcp"` in its main.tf, which configures the google
# provider for the project); applied from there. The GitHub OIDC pool `golf` already exists.
# The secret is created empty; its value is added with `gcloud secrets versions add`.

terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0"
    }
  }
}

locals {
  project_id     = "inlaid-agility-461020-e4"
  project_number = "129027965449"
  region         = "europe-west2"
  repository     = "romaninsh/books-vg"
  service        = "books-vg"
  secrets = {
    # vantage-server's datasource URL: wss://<user>:<pass>@<host>/rpc?auth=database
    "books-vg-surreal-url" = "SurrealDB Cloud URL with the books database user's credentials"
  }
}

# ── Deployer service account for GitHub Actions ──────────────────────────

resource "google_service_account" "deployer" {
  account_id   = "github-books-vg"
  display_name = "GitHub Actions deployer for romaninsh/books-vg"
}

# books-vg's own provider in the shared `golf` pool. It admits only books-vg's runs on main while main
# is a protected branch (ref_protected), and stamps them with an attribute no other provider sets,
# so the deployer below can't be reached through the pool's general provider.
resource "google_iam_workload_identity_pool_provider" "main" {
  workload_identity_pool_id          = "golf"
  workload_identity_pool_provider_id = "books-vg-main"
  display_name                       = "books-vg, protected main"
  attribute_condition                = "assertion.repository == '${local.repository}' && assertion.ref == 'refs/heads/main' && string(assertion.ref_protected) == 'true'"
  attribute_mapping = {
    "google.subject"            = "assertion.sub"
    "attribute.repository"      = "assertion.repository"
    "attribute.books_vg_deploy" = "'protected-main'"
  }
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "workload_identity_user" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${local.project_number}/locations/global/workloadIdentityPools/golf/attribute.books_vg_deploy/protected-main"
}

# books-vg's own image repository, so the deployer can't replace other apps' images.
resource "google_artifact_registry_repository" "images" {
  location      = local.region
  repository_id = "books-vg"
  description   = "books-vg's image (the deploy workflow pushes here)"
  format        = "DOCKER"

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-10-newest"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-the-rest"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 days; the KEEP policy above wins for the 10 newest
    }
  }
}

resource "google_artifact_registry_repository_iam_member" "writer" {
  project    = local.project_id
  location   = local.region
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}

# What `gcloud run deploy` of a new revision to an existing service needs, and nothing else.
resource "google_project_iam_custom_role" "deployer" {
  role_id     = "booksVgDeployer"
  title       = "books-vg deployer"
  description = "Deploy a new revision to the existing books-vg Cloud Run service."
  permissions = [
    "run.services.get",
    "run.services.update",
    "run.revisions.get",
    "run.revisions.list",
    "run.configurations.get",
    "run.routes.get",
    "run.operations.get",
  ]
}

# Bound on the books-vg service only, not the project's other services.
resource "google_cloud_run_v2_service_iam_member" "deployer" {
  project  = local.project_id
  location = local.region
  name     = google_cloud_run_v2_service.books.name
  role     = google_project_iam_custom_role.deployer.id
  member   = google_service_account.deployer.member
}

# ── Runtime identity ─────────────────────────────────────────────────────
# What the container runs as: it can read the books-vg secret and nothing else.

resource "google_service_account" "runtime" {
  account_id   = "books-vg-runtime"
  display_name = "books-vg's Cloud Run service"
}

# Cloud Run deploys need actAs on the runtime service account.
resource "google_service_account_iam_member" "act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = google_service_account.deployer.member
}

# ── Secrets (no versions here) ───────────────────────────────────────────

resource "google_secret_manager_secret" "secret" {
  for_each  = local.secrets
  secret_id = each.key
  labels    = { app = "books-vg" }
  annotations = {
    purpose = each.value
  }
  replication {
    user_managed {
      replicas {
        location = local.region
      }
    }
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_reads" {
  for_each  = google_secret_manager_secret.secret
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.runtime.member
}

# ── The service, public ──────────────────────────────────────────────────
# Created here with Google's placeholder container so it can be made public before the first
# deploy. The deploy workflow owns what runs (image, env, secrets, size): `template` is ignored
# after creation, so a re-apply never rolls a deploy back.

resource "google_cloud_run_v2_service" "books" {
  name     = local.service
  location = local.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
    }
  }

  lifecycle {
    ignore_changes = [template, client, client_version]
  }
}

# No sign-in in the app (anonymised demo books, like sap-vg): the URL is open to anyone.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = local.project_id
  location = local.region
  name     = google_cloud_run_v2_service.books.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "deployer_email" {
  value = google_service_account.deployer.email
}

output "runtime_email" {
  value = google_service_account.runtime.email
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.main.name
}
