// Frontend-Teil des Plugins "IFC Hub" (wird beim Image-Build über
// `openproject:plugins:register_frontend` in OpenProjects Angular-App
// eingebunden — siehe deploy/openproject-local/Dockerfile).
//
// OpenProjects Upload in externe Speicher kennt nur Nextcloud, OneDrive und
// SharePoint (StorageUploadService#setUploadStrategy wirft sonst "unknown
// storage type"). Der Service wird pro Komponente bereitgestellt und lässt
// sich daher nicht per DI ersetzen — dieses Modul ergänzt die Methode um den
// Speichertyp "IFC Hub" und reicht alle anderen Typen unverändert durch.
//
// Vor jedem Upload fragt ein Dialog die Commit-Nachricht ab: Im Hub wird
// jeder Upload ein Commit (neue Version bzw. neues Modell).
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  NgModule,
  inject,
} from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { defer, Observable } from 'rxjs';
import { map, share, switchMap, take } from 'rxjs/operators';

import { I18nService } from 'core-app/core/i18n/i18n.service';
import { TimezoneService } from 'core-app/core/datetime/timezone.service';
import { IStorageFile } from 'core-app/core/state/storage-files/storage-file.model';
import { IStorage } from 'core-app/core/state/storages/storage.model';
import { IUploadFile } from 'core-app/core/upload/upload.service';
import convertHttpEvent from 'core-app/core/upload/convert-http-event';
import { EXTERNAL_REQUEST_HEADER } from 'core-app/features/hal/http/openproject-header-interceptor';
import { OpModalComponent } from 'core-app/shared/components/modal/modal.component';
import { OpModalService } from 'core-app/shared/components/modal/modal.service';
import { isDirectory } from 'core-app/shared/components/storages/functions/storages.functions';
import {
  LocationPickerModalComponent,
} from 'core-app/shared/components/storages/location-picker-modal/location-picker-modal.component';
import { StorageFileListItem } from 'core-app/shared/components/storages/storage-file-list-item/storage-file-list-item';
import { IUploadStrategy } from 'core-app/shared/components/storages/upload/upload-strategy';
import { StorageUploadService } from 'core-app/shared/components/storages/upload/storage-upload.service';

/** `_links.type.href` des Speichers (Storages::IfcHubStorage hat keine URN). */
export const IFC_HUB_STORAGE_TYPE = 'Storages::IfcHubStorage';

interface IfcHubUploadResponse {
  id:string;
  name:string;
  mimeType:string;
  size:number;
}

/**
 * In der Ordnerauswahl angehakte Datei: Der Upload wird eine neue Version
 * dieses Modells (auch bei anderem Dateinamen). Gesetzt beim Bestätigen der
 * Ordnerauswahl, verbraucht vom nächsten Upload, verworfen beim nächsten
 * Öffnen der Auswahl.
 */
let pendingTarget:IStorageFile|null = null;

function takePendingTarget():IStorageFile|null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

/** Vorbelegung: Bezug auf das Arbeitspaket, aus dem hochgeladen wird. */
function defaultCommitMessage(i18n:I18nService):string {
  const workPackage = /\/work_packages\/(\d+)/.exec(window.location.pathname);
  return workPackage
    ? i18n.t('js.ifc_hub.commit_message.default_with_work_package', {
      id: workPackage[1],
      defaultValue: `Hochgeladen aus OpenProject (Arbeitspaket #${workPackage[1]})`,
    })
    : i18n.t('js.ifc_hub.commit_message.default', { defaultValue: 'Hochgeladen aus OpenProject' });
}

/**
 * Dialog "Commit-Nachricht". Bewusst ohne Abbrechen: OpenProjects
 * Upload-Toast wartet auf eine Antwort und bliebe sonst hängen — abbrechen
 * lässt sich vorher in der Datei- bzw. Ordnerauswahl.
 */
@Component({
  template: `
    <div class="spot-modal">
      <div class="spot-modal--header">
        <span id="spotModalTitle" class="spot-modal--header-title" [textContent]="text.header"></span>
      </div>
      <div class="spot-modal--body spot-container">
        <label class="spot-body-small" for="ifc-hub-commit-message" [textContent]="text.label"></label>
        <textarea
          id="ifc-hub-commit-message"
          class="form--text-area"
          rows="3"
          style="width: 100%; margin-top: 0.5rem"
          [value]="message"
          (input)="message = $any($event.target).value"
          (keydown.control.enter)="closeMe()"
        ></textarea>
        <span class="spot-body-small" style="display: block; margin-top: 0.5rem" [textContent]="text.hint"></span>
      </div>
      <div class="spot-action-bar">
        <div class="spot-action-bar--right">
          <button
            type="button"
            class="button spot-action-bar--action -primary"
            [textContent]="text.upload"
            (click)="closeMe()"
          ></button>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class IfcHubCommitMessageModalComponent extends OpModalComponent {
  private readonly i18n = inject(I18nService);

  override showCloseButton = false;

  public message = (this.locals.defaultMessage as string) ?? '';

  public text = {
    header: this.locals.targetName
      ? this.i18n.t('js.ifc_hub.commit_message.header_target', {
        name: this.locals.targetName as string,
        defaultValue: `Neue Version von „${this.locals.targetName as string}“`,
      })
      : this.i18n.t('js.ifc_hub.commit_message.header', { defaultValue: 'Neue Version im IFC Hub' }),
    label: this.i18n.t('js.ifc_hub.commit_message.label', {
      fileName: this.locals.fileName as string,
      defaultValue: `Commit-Nachricht für „${this.locals.fileName as string}“`,
    }),
    hint: this.i18n.t('js.ifc_hub.commit_message.hint', {
      defaultValue: 'Die Nachricht erscheint in der Versionshistorie des Modells im IFC Hub.',
    }),
    upload: this.i18n.t('js.ifc_hub.commit_message.upload', { defaultValue: 'Hochladen' }),
  };
}

/** Multipart-POST an den signierten Upload-Link des Hubs. */
export class IfcHubUploadStrategy implements IUploadStrategy {
  constructor(
    private readonly http:HttpClient,
    private readonly injector:Injector,
  ) { }

  public execute<T>(href:string, uploadFiles:IUploadFile[]):Observable<HttpEvent<T>>[] {
    return uploadFiles.map((file) => this.uploadSingle<T>(href, file));
  }

  private uploadSingle<T>(href:string, uploadFile:IUploadFile):Observable<HttpEvent<T>> {
    const target = takePendingTarget();
    return this.askForMessage(uploadFile, target).pipe(
      switchMap((message) => {
        const body = new FormData();
        // true = neue Version des gleichnamigen Modells, false = beide behalten
        if (uploadFile.overwrite !== undefined) {
          body.append('overwrite', String(uploadFile.overwrite));
        }
        // Angehakte Datei: neue Version genau dieses Modells.
        if (target) {
          body.append('target', target.id as string);
        }
        body.append('message', message);
        body.append('file', uploadFile.file, uploadFile.file.name);

        return this.http.request<IfcHubUploadResponse>(
          'post',
          href,
          {
            body,
            headers: { [EXTERNAL_REQUEST_HEADER]: 'true' },
            observe: 'events',
            reportUploadProgress: true,
            reportDownloadProgress: true,
            responseType: 'json',
          },
        );
      }),
      // Toast und Speicher-Komponente abonnieren beide: Dialog und Upload
      // nur einmal ausführen.
      share(),
      map((event) =>
        convertHttpEvent(event, (responseBody) => ({
          id: responseBody.id,
          name: responseBody.name,
          size: responseBody.size,
          mimeType: responseBody.mimeType,
        } as T))),
    );
  }

  /** Öffnet den Dialog erst beim Abonnieren; leer = Vorbelegung. */
  private askForMessage(uploadFile:IUploadFile, target:IStorageFile|null):Observable<string> {
    return defer(() => {
      const defaultMessage = defaultCommitMessage(this.injector.get(I18nService));
      return this.injector
        .get(OpModalService)
        .show(IfcHubCommitMessageModalComponent, 'global', {
          fileName: uploadFile.file.name,
          targetName: target?.name,
          defaultMessage,
        })
        .pipe(
          switchMap((modal) => modal.closingEvent),
          take(1),
          map((modal) => modal.message.trim() || defaultMessage),
        );
    });
  }
}

/** Die privaten Felder von StorageUploadService, die wir setzen. */
interface StorageUploadServiceInternals {
  http:HttpClient;
  uploadStrategy:IUploadStrategy;
}

let patched = false;

function registerIfcHubUploadStrategy(injector:Injector):void {
  if (patched) {
    return;
  }
  patched = true;

  const original = StorageUploadService.prototype.setUploadStrategy;
  StorageUploadService.prototype.setUploadStrategy = function setUploadStrategy(
    this:StorageUploadService,
    storageType:string,
  ):void {
    if (storageType === IFC_HUB_STORAGE_TYPE) {
      const internals = this as unknown as StorageUploadServiceInternals;
      internals.uploadStrategy = new IfcHubUploadStrategy(internals.http, injector);
      return;
    }
    original.call(this, storageType);
  };
}

// ---- Ordnerauswahl: Datei als Ziel einer neuen Version anhaken ----------

/** Die (privaten) Teile von LocationPickerModalComponent, die wir nutzen. */
interface LocationPickerInternals {
  storage:IStorage;
  timezoneService:TimezoneService;
  storageFiles$:{ getValue():IStorageFile[]; next(files:IStorageFile[]):void };
  cdRef:{ detectChanges():void };
  text:{ buttons:{ submit:string } };
  filesAtLocation:IStorageFile[];
  ngOnInit():void;
  chooseLocation():void;
  storageFileToListItem(file:IStorageFile, index:number):StorageFileListItem;
  ifcHubTarget?:IStorageFile|null;
  ifcHubSubmitLabel?:string;
}

function isIfcHubPicker(picker:LocationPickerInternals):boolean {
  return picker.storage?._links?.type?.href === IFC_HUB_STORAGE_TYPE;
}

/** Zielauswahl setzen/aufheben und Liste + Knopf neu zeichnen. */
function selectTarget(picker:LocationPickerInternals, file:IStorageFile|null, i18n:I18nService):void {
  picker.ifcHubTarget = file;
  picker.ifcHubSubmitLabel ??= picker.text.buttons.submit;
  picker.text.buttons.submit = file
    ? i18n.t('js.ifc_hub.location_picker.submit_version', { defaultValue: 'Als neue Version hochladen' })
    : picker.ifcHubSubmitLabel;
  picker.storageFiles$.next([...picker.storageFiles$.getValue()]);
  picker.cdRef.detectChanges();
}

function registerIfcHubLocationPicker(injector:Injector):void {
  const proto = LocationPickerModalComponent.prototype as unknown as LocationPickerInternals;
  const i18n = () => injector.get(I18nService);

  const originalInit = proto.ngOnInit;
  proto.ngOnInit = function ngOnInit(this:LocationPickerInternals):void {
    pendingTarget = null;
    this.ifcHubTarget = null;
    originalInit.call(this);
  };

  const originalItem = proto.storageFileToListItem;
  proto.storageFileToListItem = function storageFileToListItem(
    this:LocationPickerInternals,
    file:IStorageFile,
    index:number,
  ):StorageFileListItem {
    const item = originalItem.call(this, file, index);
    if (!isIfcHubPicker(this)) {
      return item;
    }
    // Ordner gewechselt: Auswahl aus dem vorherigen Ordner verwerfen.
    if (index === 0 && this.ifcHubTarget
      && !this.storageFiles$.getValue().some((f) => f.id === this.ifcHubTarget?.id)) {
      this.ifcHubTarget = null;
      if (this.ifcHubSubmitLabel) {
        this.text.buttons.submit = this.ifcHubSubmitLabel;
      }
    }
    if (isDirectory(file) || !file.permissions.includes('writeable')) {
      return item;
    }

    const picker = this;
    return new StorageFileListItem(
      this.timezoneService,
      file,
      false,
      index === 0,
      item.enterDirectory,
      false,
      i18n().t('js.ifc_hub.location_picker.file_tooltip', {
        defaultValue: 'Anhaken: Die hochgeladene Datei wird eine neue Version dieses Modells.',
      }),
      {
        get selected() {
          return picker.ifcHubTarget?.id === file.id;
        },
        changeSelection: () => {
          const next = picker.ifcHubTarget?.id === file.id ? null : file;
          selectTarget(picker, next, i18n());
        },
      },
    );
  };

  const originalChoose = proto.chooseLocation;
  proto.chooseLocation = function chooseLocation(this:LocationPickerInternals):void {
    const target = this.ifcHubTarget;
    pendingTarget = isIfcHubPicker(this) && target && this.filesAtLocation.some((f) => f.id === target.id)
      ? target
      : null;
    originalChoose.call(this);
  };
}

@NgModule({
  declarations: [IfcHubCommitMessageModalComponent],
})
export class PluginModule {
  constructor() {
    const injector = inject(Injector);
    registerIfcHubUploadStrategy(injector);
    registerIfcHubLocationPicker(injector);
  }
}
