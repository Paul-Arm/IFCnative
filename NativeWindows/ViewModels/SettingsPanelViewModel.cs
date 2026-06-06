using System;
using System.Collections.Generic;
using ReactiveUI;
using IFCnative.NativeWindows.Models;

namespace IFCnative.NativeWindows.ViewModels;

public sealed class SettingsPanelViewModel : ReactiveViewModel
{
    private readonly MainWindowViewModel owner;
    private AntiAliasingMode selectedAntiAliasing;
    private bool hideSpaces;
    private double fieldOfView;
    private double nearPlane;
    private double farPlane;

    public SettingsPanelViewModel(MainWindowViewModel owner)
    {
        this.owner = owner;
        selectedAntiAliasing = owner.CurrentPreferences.AntiAliasing;
        hideSpaces = owner.CurrentPreferences.HideSpaces;
        fieldOfView = owner.CurrentPreferences.FieldOfView;
        nearPlane = owner.CurrentPreferences.NearPlane;
        farPlane = owner.CurrentPreferences.FarPlane;

        owner.PropertyChanged += (sender, e) =>
        {
            if (e.PropertyName == nameof(MainWindowViewModel.TextScale))
            {
                this.RaisePropertyChanged(nameof(TextScale));
                this.RaisePropertyChanged(nameof(TextScalePercent));
            }
        };
    }

    public List<AntiAliasingMode> AntiAliasingOptions { get; } = [
        AntiAliasingMode.None,
        AntiAliasingMode.Msaa4x,
        AntiAliasingMode.Msaa8x,
        AntiAliasingMode.Fxaa
    ];

    public AntiAliasingMode SelectedAntiAliasing
    {
        get => selectedAntiAliasing;
        set
        {
            if (SetProperty(ref selectedAntiAliasing, value))
            {
                owner.UpdateAntiAliasing(value);
            }
        }
    }

    public bool HideSpaces
    {
        get => hideSpaces;
        set
        {
            if (SetProperty(ref hideSpaces, value))
            {
                owner.UpdateHideSpaces(value);
            }
        }
    }

    public double FieldOfView
    {
        get => fieldOfView;
        set
        {
            if (SetProperty(ref fieldOfView, value))
            {
                owner.UpdateFieldOfView(value);
            }
        }
    }

    public double NearPlane
    {
        get => nearPlane;
        set
        {
            if (SetProperty(ref nearPlane, value))
            {
                owner.UpdateNearPlane(value);
            }
        }
    }

    public double FarPlane
    {
        get => farPlane;
        set
        {
            if (SetProperty(ref farPlane, value))
            {
                owner.UpdateFarPlane(value);
            }
        }
    }

    public double TextScale
    {
        get => owner.TextScale;
        set => owner.TextScale = value;
    }

    public string TextScalePercent => owner.TextScalePercent;

    public void LoadPreferences(NativeUserPreferences preferences)
    {
        SelectedAntiAliasing = preferences.AntiAliasing;
        HideSpaces = preferences.HideSpaces;
        FieldOfView = preferences.FieldOfView;
        NearPlane = preferences.NearPlane;
        FarPlane = preferences.FarPlane;
    }
}
