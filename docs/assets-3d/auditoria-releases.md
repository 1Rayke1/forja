# Auditoria dos anexos 3D das releases

Gerado por `tools/auditar-assets-3d-releases.sh` em 2026-11-01 02:42 UTC.
Diretório auditado: `assets-3d`. Nenhum arquivo foi alterado.

| Arquivo | Tamanho | Formato real (cabeçalho) | SHA-256 |
| --- | --- | --- | --- |
| `DeskBreak-Setup.exe` | 109MiB (114123886 bytes) | PE32 executable (GUI) Intel 80386, for MS Windows, Nullsoft Installer self-extracting archive, 5 sections | `e7395a29c8f0305f…` |
| `Mocap_Pack_06_Fitness_and_Workout.zip` | 237MiB (248490024 bytes) | Zip archive data, at least v2.0 to extract, compression method=store | `dc96964d4441035b…` |

## 1. DeskBreak-Setup.exe

- Tamanho: **109MiB** (114123886 bytes)
- Formato detectado pelo conteúdo: **PE32 executable (GUI) Intel 80386, for MS Windows, Nullsoft Installer self-extracting archive, 5 sections**
- Primeiros 16 bytes (hex): `4d 5a 90 00 03 00 00 00 04 00 00 00 ff ff 00 00`
- `file`: `PE32 executable (GUI) Intel 80386, for MS Windows, Nullsoft Installer self-extracting archive, 5 sections`

### Instalador Windows (PE)

```

7-Zip 23.01 (x64) : Copyright (c) 1999-2023 Igor Pavlov : 2023-06-20
 64-bit locale=C.UTF-8 Threads:4 OPEN_MAX:65536

Scanning the drive for archives:
1 file, 114123886 bytes (109 MiB)

Listing archive: /tmp/assets-3d/DeskBreak-Setup.exe

--
Path = /tmp/assets-3d/DeskBreak-Setup.exe
Type = Nsis
Physical Size = 114123886
Method = Deflate
Solid = -
Headers Size = 121958
Embedded Stub Size = 123904
SubType = NSIS-3 Unicode

   Date      Time    Attr         Size   Compressed  Name
------------------- ----- ------------ ------------  ------------------------
                    .....                      6931  $PLUGINSDIR/System.dll
                    .....                     45608  $PLUGINSDIR/StdUtils.dll
                    .....                      4615  $PLUGINSDIR/SpiderBanner.dll
                    .....                      3299  $PLUGINSDIR/nsExec.dll
2026-10-07 12:48:00 .....    113485338    113485338  $PLUGINSDIR/app-64.7z
                    .....                    242382  $PLUGINSDIR/nsis7z.dll
2026-10-07 12:48:02 .....                    182251  $R0/Uninstall DeskBreak.exe
                    .....                      1080  $PLUGINSDIR/WinShell.dll
------------------- ----- ------------ ------------  ------------------------
2026-10-07 12:48:02          113485338    113971504  8 files
```

Extensões dentro do instalador:

          1 exe
          1 7z

Strings com nomes de formatos 3D:

```
```

## 1. Mocap_Pack_06_Fitness_and_Workout.zip

- Tamanho: **237MiB** (248490024 bytes)
- Formato detectado pelo conteúdo: **Zip archive data, at least v2.0 to extract, compression method=store**
- Primeiros 16 bytes (hex): `50 4b 03 04 14 00 00 00 00 00 1a 79 1b 5d 00 00`
- `file`: `Zip archive data, at least v2.0 to extract, compression method=store`

### Conteúdo do ZIP

Arquivos: **70**; itens listados pelo ZIP: 76.

Extensões encontradas:

| Extensão | Quantidade | Soma dos tamanhos |
| --- | ---: | ---: |
| .(sem extensão) | 6 | 0 |
| .fbx | 66 | 661151280 |
| .pdf | 1 | 13823117 |
| .uasset | 3 | 396307 |

<details><summary>Lista completa (até 400 entradas)</summary>

```
Archive:  /tmp/assets-3d/Mocap_Pack_06_Fitness_and_Workout.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-08-27 15:08   Mocap_Pack_06_Fitness_and_Workout/
 13823117  2026-03-08 15:40   Mocap_Pack_06_Fitness_and_Workout/Importing_into_UE5.pdf
        0  2026-08-27 15:08   Mocap_Pack_06_Fitness_and_Workout/RTG_RKK_to_MH/
    87058  2026-02-19 17:03   Mocap_Pack_06_Fitness_and_Workout/RTG_RKK_to_MH/IK_Source.uasset
   277763  2026-02-19 17:03   Mocap_Pack_06_Fitness_and_Workout/RTG_RKK_to_MH/IK_Target.uasset
    31486  2026-02-19 17:03   Mocap_Pack_06_Fitness_and_Workout/RTG_RKK_to_MH/RTG_RKK_to_MH.uasset
        0  2026-08-27 15:08   Mocap_Pack_06_Fitness_and_Workout/mocap/
        0  2026-08-27 18:29   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/
 11923888  2026-08-27 18:23   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/01_Box_Step_Up_And_Down_01.fbx
 14122768  2026-08-27 18:23   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/02_Box_Step_Up_And_Down_02.fbx
 16050896  2026-08-27 18:23   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/03_Box_Step_Up_And_Down_03.fbx
 14904320  2026-08-27 18:23   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/04_Box_Step_Up_And_Down_04.fbx
  7481184  2026-08-27 18:23   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/05_Forward_Backward_Run.fbx
  5429248  2026-08-27 18:23   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/06_Jumping_Jacks.fbx
  6236400  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/07_Standing_Jump.fbx
  6908736  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/08_Stretching_01.fbx
  7191664  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/09_Stretching_02.fbx
  8699072  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/10_Stretching_03.fbx
  7847632  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/11_Stretching_04.fbx
 12998864  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/12_Weighted_Forward_Lunge.fbx
 15004912  2026-08-27 18:25   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/13_Dumbbell_Squat.fbx
 11004192  2026-08-27 18:26   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/14_Calf_Raise.fbx
 10760496  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/15_Barbell_Upright_Row.fbx
 11429136  2026-08-27 18:24   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/16_Barbell_Curl.fbx
 11759632  2026-08-27 18:25   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/17_Dumbbell_Curl_Rotation.fbx
 10852544  2026-08-27 18:25   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/18_Dumbbell_Lateral_Raise.fbx
 11389136  2026-08-27 18:25   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/19_Seated_Row.fbx
 12968992  2026-08-27 18:25   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/20_Pec_Deck.fbx
 11466816  2026-08-27 18:25   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/21_Bench_Press.fbx
  5055232  2026-08-27 18:25   Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/22_Biceps_Pose.fbx
        0  2026-08-27 18:22   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/
 11967984  2026-08-27 18:11   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/01_Box_Step_Up_And_Down_01_ue5.fbx
 14318656  2026-08-27 18:11   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/02_Box_Step_Up_And_Down_02_ue5.fbx
 16354880  2026-08-27 18:11   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/03_Box_Step_Up_And_Down_03_ue5.fbx
 15132048  2026-08-27 18:11   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/04_Box_Step_Up_And_Down_04_ue5.fbx
  7230048  2026-08-27 18:11   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/05_Forward_Backward_Run_ue5.fbx
  5042240  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/06_Jumping_Jacks_ue5.fbx
  5900688  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/07_Standing_Jump_ue5.fbx
  6611248  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/08_Stretching_01_ue5.fbx
  6924096  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/09_Stretching_02_ue5.fbx
  8527872  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/10_Stretching_03_ue5.fbx
  7629936  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/11_Stretching_04_ue5.fbx
 13083520  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/12_Weighted_Forward_Lunge_ue5.fbx
 15208288  2026-08-27 18:14   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/13_Dumbbell_Squat_ue5.fbx
 10958512  2026-08-27 18:14   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/14_Calf_Raise_ue5.fbx
 10718784  2026-08-27 18:12   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/15_Barbell_Upright_Row_ue5.fbx
 11404304  2026-08-27 18:13   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/16_Barbell_Curl_ue5.fbx
 11773840  2026-08-27 18:13   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/17_Dumbbell_Curl_Rotation_ue5.fbx
 10828272  2026-08-27 18:13   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/18_Dumbbell_Lateral_Raise_ue5.fbx
 11384048  2026-08-27 18:13   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/19_Seated_Row_ue5.fbx
 13031024  2026-08-27 18:13   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/20_Pec_Deck_ue5.fbx
 11443248  2026-08-27 18:14   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/21_Bench_Press_ue5.fbx
  4643616  2026-08-27 18:14   Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/22_Biceps_Pose_ue5.fbx
        0  2026-08-27 18:57   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/
 10338800  2026-08-27 18:29   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/01_Box_Step_Up_And_Down_01_iclone.fbx
 12325648  2026-08-27 18:30   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/02_Box_Step_Up_And_Down_02_iclone.fbx
 14052960  2026-08-27 18:30   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/03_Box_Step_Up_And_Down_03_iclone.fbx
 13013328  2026-08-27 18:30   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/04_Box_Step_Up_And_Down_04_iclone.fbx
  6331984  2026-08-27 18:30   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/05_Forward_Backward_Run_iclone.fbx
  4486128  2026-08-27 18:30   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/06_Jumping_Jacks_iclone.fbx
  5209840  2026-08-27 18:30   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/07_Standing_Jump_iclone.fbx
  5812480  2026-08-27 18:30   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/08_Stretching_01_iclone.fbx
  6076912  2026-08-27 18:31   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/09_Stretching_02_iclone.fbx
  7433552  2026-08-27 18:31   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/10_Stretching_03_iclone.fbx
  6672768  2026-08-27 18:31   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/11_Stretching_04_iclone.fbx
 11293616  2026-08-27 18:31   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/12_Weighted_Forward_Lunge_iclone.fbx
 13098576  2026-08-27 18:33   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/13_Dumbbell_Squat_iclone.fbx
  9502208  2026-08-27 18:33   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/14_Calf_Raise_iclone.fbx
  9289184  2026-08-27 18:31   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/15_Barbell_Upright_Row_iclone.fbx
  9872800  2026-08-27 18:31   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/16_Barbell_Curl_iclone.fbx
 10184560  2026-08-27 18:32   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/17_Dumbbell_Curl_Rotation_iclone.fbx
  9379792  2026-08-27 18:32   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/18_Dumbbell_Lateral_Raise_iclone.fbx
  9849968  2026-08-27 18:32   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/19_Seated_Row_iclone.fbx
 11265888  2026-08-27 18:32   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/20_Pec_Deck_iclone.fbx
  9906720  2026-08-27 18:32   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/21_Bench_Press_iclone.fbx
  4150656  2026-08-27 18:33   Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/22_Biceps_Pose_iclone.fbx
---------                     -------
675370704                     76 files
```

</details>

### Arquivos 3D/animação dentro do ZIP

- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/01_Box_Step_Up_And_Down_01.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/02_Box_Step_Up_And_Down_02.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/03_Box_Step_Up_And_Down_03.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/04_Box_Step_Up_And_Down_04.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/05_Forward_Backward_Run.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/06_Jumping_Jacks.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/07_Standing_Jump.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/08_Stretching_01.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/09_Stretching_02.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/10_Stretching_03.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/11_Stretching_04.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/12_Weighted_Forward_Lunge.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/13_Dumbbell_Squat.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/14_Calf_Raise.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/15_Barbell_Upright_Row.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/16_Barbell_Curl.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/17_Dumbbell_Curl_Rotation.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/18_Dumbbell_Lateral_Raise.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/19_Seated_Row.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/20_Pec_Deck.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/21_Bench_Press.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/Rokoko_Default/22_Biceps_Pose.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/01_Box_Step_Up_And_Down_01_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/02_Box_Step_Up_And_Down_02_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/03_Box_Step_Up_And_Down_03_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/04_Box_Step_Up_And_Down_04_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/05_Forward_Backward_Run_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/06_Jumping_Jacks_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/07_Standing_Jump_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/08_Stretching_01_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/09_Stretching_02_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/10_Stretching_03_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/11_Stretching_04_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/12_Weighted_Forward_Lunge_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/13_Dumbbell_Squat_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/14_Calf_Raise_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/15_Barbell_Upright_Row_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/16_Barbell_Curl_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/17_Dumbbell_Curl_Rotation_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/18_Dumbbell_Lateral_Raise_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/19_Seated_Row_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/20_Pec_Deck_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/21_Bench_Press_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/UE5/22_Biceps_Pose_ue5.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/01_Box_Step_Up_And_Down_01_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/02_Box_Step_Up_And_Down_02_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/03_Box_Step_Up_And_Down_03_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/04_Box_Step_Up_And_Down_04_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/05_Forward_Backward_Run_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/06_Jumping_Jacks_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/07_Standing_Jump_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/08_Stretching_01_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/09_Stretching_02_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/10_Stretching_03_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/11_Stretching_04_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/12_Weighted_Forward_Lunge_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/13_Dumbbell_Squat_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/14_Calf_Raise_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/15_Barbell_Upright_Row_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/16_Barbell_Curl_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/17_Dumbbell_Curl_Rotation_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/18_Dumbbell_Lateral_Raise_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/19_Seated_Row_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/20_Pec_Deck_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/21_Bench_Press_iclone.fbx`
- `Mocap_Pack_06_Fitness_and_Workout/mocap/iClone/22_Biceps_Pose_iclone.fbx`

- `Mocap_Pack_06_Fitness_and_Workout/Importing_into_UE5.pdf`

## Resumo

- Anexos auditados: 2
- Ferramentas: `UnZip 6.00 of 20 April 2009, by Debian. `, `7z`: sim, `blender`: não.
